/**
 * Coverage for ``ESPHomeAPI.subscribeDeviceReachability``.
 *
 * Pin the four contract points the drawer relies on:
 *
 * 1. Subscribe sends ``devices/subscribe_reachability`` with the
 *    ``device_name`` arg and resolves on the
 *    ``{"subscribed": true}`` result.
 * 2. ``reachability_state`` events on the same message_id flow
 *    into the caller's callback.
 * 3. Other events on the same message_id are filtered out (we
 *    only forward the dedicated event name) — defends the
 *    callback's typed payload contract from a backend drift
 *    that adds a new event type.
 * 4. Unsubscribe sends ``devices/stop_stream`` with the
 *    subscription's message_id and stops forwarding events to
 *    the caller's callback regardless of whether the stop_stream
 *    round trip lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ESPHomeAPI } from "../../src/api/esphome-api.js";
import type { ReachabilityStateEvent } from "../../src/api/types.js";
import {
  MockWebSocket,
  installMockWebSocket,
  uninstallMockWebSocket,
} from "./mock-websocket.js";

const serverInfo = {
  server_version: "1.0.0",
  esphome_version: "2025.1.0",
  port: 6052,
  ha_addon: false,
  requires_auth: false,
};

async function connect(api: ESPHomeAPI): Promise<MockWebSocket> {
  const pending = api.connect();
  const ws = MockWebSocket.latest();
  ws.open();
  ws.receive(serverInfo);
  await pending;
  return ws;
}

const SAMPLE_STATE: ReachabilityStateEvent = {
  device: "kitchen",
  state: "online" as ReachabilityStateEvent["state"],
  active_source: "mdns",
  ip: "10.0.0.42",
  mdns_last_seen_seconds_ago: 12.4,
  mdns_ttl_remaining_seconds: 107.6,
  ping_last_seen_seconds_ago: 47.0,
  mqtt_last_seen_seconds_ago: null,
  ping_rtt_ms: null,
};

describe("ESPHomeAPI.subscribeDeviceReachability", () => {
  beforeEach(() => {
    installMockWebSocket();
  });
  afterEach(() => {
    uninstallMockWebSocket();
  });

  it("sends subscribe_reachability and resolves on the subscribed result", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const callback = vi.fn();

    const pending = api.subscribeDeviceReachability("kitchen", callback);

    // The very first frame the client sends after connect is the
    // subscribe — the server-info exchange happens inside the
    // mock's ``receive`` and doesn't generate a sent payload.
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: { device_name: string };
    }>(0);
    expect(sent.command).toBe("devices/subscribe_reachability");
    expect(sent.args).toEqual({ device_name: "kitchen" });

    ws.receive({ message_id: sent.message_id, result: { subscribed: true } });
    const sub = await pending;
    expect(sub.unsubscribe).toBeTypeOf("function");
  });

  it("forwards reachability_state events to the caller", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const callback = vi.fn();

    const pending = api.subscribeDeviceReachability("kitchen", callback);
    const msgId = ws.sentAs<{ message_id: string }>(0).message_id;
    ws.receive({ message_id: msgId, result: { subscribed: true } });
    await pending;

    ws.receive({
      message_id: msgId,
      event: "reachability_state",
      data: SAMPLE_STATE,
    });
    expect(callback).toHaveBeenCalledWith(SAMPLE_STATE);
  });

  it("ignores other event types on the same message_id", async () => {
    // Defends against a future backend that fires a different
    // event on the same subscription (e.g. a "subscription
    // closed" lifecycle frame). The typed callback should only
    // see ``reachability_state`` payloads — anything else is a
    // protocol drift the drawer should not surface as a state.
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const callback = vi.fn();

    const pending = api.subscribeDeviceReachability("kitchen", callback);
    const msgId = ws.sentAs<{ message_id: string }>(0).message_id;
    ws.receive({ message_id: msgId, result: { subscribed: true } });
    await pending;

    ws.receive({
      message_id: msgId,
      event: "some_other_event",
      data: { foo: "bar" },
    });
    expect(callback).not.toHaveBeenCalled();

    // Sanity: the right event still gets through.
    ws.receive({
      message_id: msgId,
      event: "reachability_state",
      data: SAMPLE_STATE,
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe sends devices/stop_stream and stops delivering events", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const callback = vi.fn();

    const pending = api.subscribeDeviceReachability("kitchen", callback);
    const subId = ws.sentAs<{ message_id: string }>(0).message_id;
    ws.receive({ message_id: subId, result: { subscribed: true } });
    const sub = await pending;

    // Pre-unsubscribe: events flow.
    ws.receive({
      message_id: subId,
      event: "reachability_state",
      data: SAMPLE_STATE,
    });
    expect(callback).toHaveBeenCalledTimes(1);

    const unsubPromise = sub.unsubscribe();
    // The unsubscribe sends a stop_stream — second sent frame.
    const stopSent = ws.sentAs<{
      command: string;
      args: { stream_id: string };
      message_id: string;
    }>(1);
    expect(stopSent.command).toBe("devices/stop_stream");
    expect(stopSent.args).toEqual({ stream_id: subId });

    // Resolve the stop_stream so the unsubscribe promise settles.
    ws.receive({
      message_id: stopSent.message_id,
      result: { cancelled: true },
    });
    await unsubPromise;

    // Post-unsubscribe: late events get dropped client-side
    // even if the backend stream hasn't fully torn down yet.
    ws.receive({
      message_id: subId,
      event: "reachability_state",
      data: { ...SAMPLE_STATE, mdns_last_seen_seconds_ago: 0.5 },
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe swallows stop_stream errors", async () => {
    // The drawer-content's ``unsubscribe()`` is best-effort; the
    // per-stream task on the backend is also cancelled by the WS
    // disconnect, so a transport blip during cancel shouldn't
    // surface as an unhandled rejection.
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const callback = vi.fn();

    const pending = api.subscribeDeviceReachability("kitchen", callback);
    const subId = ws.sentAs<{ message_id: string }>(0).message_id;
    ws.receive({ message_id: subId, result: { subscribed: true } });
    const sub = await pending;

    const unsubPromise = sub.unsubscribe();
    const stopSent = ws.sentAs<{ message_id: string }>(1);
    // Server returns an error rather than a cancelled-ack.
    ws.receive({
      message_id: stopSent.message_id,
      error_code: "internal_error",
      details: "stream not found",
    });
    await expect(unsubPromise).resolves.toBeUndefined();
  });

  it("rejects on subscribe-ack timeout and cleans up the listener", async () => {
    // A non-responding backend (or a proxy that drops the
    // result frame while keeping the WS open) would otherwise
    // hang forever and leak the ``_pendingRequests`` /
    // ``_eventSubscriptions`` entries. Pin the timeout-then-reject
    // contract.
    //
    // Don't use ``vi.useFakeTimers`` — the WebSocket mock and
    // the API's reconnect logic both schedule timers, and
    // intercepting all of them at once breaks the connect
    // dance. Drive the timeout directly by stubbing
    // ``setTimeout`` only inside ``subscribeDeviceReachability``
    // via a synchronous shim that fires the callback on
    // ``advance()``.
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const callback = vi.fn();

    const realSetTimeout = globalThis.setTimeout;
    let pendingTimer: (() => void) | null = null;
    vi.stubGlobal(
      "setTimeout",
      // Rest-parameter so unrelated callers using
      // ``setTimeout(fn, delay, ...args)`` still pass their
      // extra arguments through to the real impl. Without the
      // forward, any code (test fixture, lib in node_modules)
      // scheduling a timer with extra args during this test
      // would silently lose them.
      (fn: (...args: unknown[]) => void, delay: number, ...args: unknown[]) => {
        // Capture the subscribe-ack timer (the next setTimeout
        // call after we kick off the subscribe). All other
        // timer schedules pass through to the real impl with
        // every argument they were called with.
        if (pendingTimer === null && delay === 10000) {
          pendingTimer = () => fn(...args);
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }
        return realSetTimeout(fn, delay, ...args);
      }
    );

    try {
      const pending = api.subscribeDeviceReachability("kitchen", callback);
      const sent = ws.sentAs<{ message_id: string }>(0);
      expect(pendingTimer).not.toBeNull();
      pendingTimer!(); // simulate timeout firing
      await expect(pending).rejects.toThrow(/timed out/i);

      // Late event under the same id must not reach the
      // original callback — the listener is gone.
      ws.receive({
        message_id: sent.message_id,
        event: "reachability_state",
        data: SAMPLE_STATE,
      });
      expect(callback).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects when the WS isn't open", async () => {
    const api = new ESPHomeAPI();
    // Don't connect — the call should reject immediately rather
    // than queuing forever or sending into a closed transport.
    await expect(api.subscribeDeviceReachability("kitchen", () => {})).rejects.toThrow(
      /not connected/i
    );
  });

  it("bumps connectionGeneration on every WS open", async () => {
    // The drawer's reachability subscription compares
    // ``api.connectionGeneration`` against the value captured at
    // subscribe time to detect WS reconnects (the API clears its
    // event listeners on close, so a stale subscription would
    // never recover otherwise). Pin the bump-per-connect contract
    // so a refactor that drops the increment is caught.
    const api = new ESPHomeAPI();
    expect(api.connectionGeneration).toBe(0);
    await connect(api);
    expect(api.connectionGeneration).toBe(1);
    // A second connect (simulating a reconnect after a close)
    // must increment again — proving long-lived consumers can
    // distinguish the new connection from the old.
    MockWebSocket.latest().close();
    const second = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfo);
    await second;
    expect(api.connectionGeneration).toBe(2);
  });

  it("cleans up the listener if the server rejects the subscribe", async () => {
    // Server-side rejections (NOT_FOUND for unknown device,
    // INVALID_ARGS) would otherwise leave the
    // ``_eventSubscriptions`` entry attached forever — every
    // subsequent failed subscribe would compound the leak.
    // Connection-level failures get cleared by ``_onClose``, so
    // this branch only matters for the
    // server-rejects-but-WS-stays-open shape.
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const callback = vi.fn();

    const pending = api.subscribeDeviceReachability("ghost", callback);
    const sent = ws.sentAs<{ message_id: string }>(0);

    ws.receive({
      message_id: sent.message_id,
      error_code: "not_found",
      details: "No configured device named 'ghost'",
    });
    await expect(pending).rejects.toThrow();

    // After the rejection, a stray event under the same id must
    // not reach the original callback — proving the listener is
    // gone.
    ws.receive({
      message_id: sent.message_id,
      event: "reachability_state",
      data: SAMPLE_STATE,
    });
    expect(callback).not.toHaveBeenCalled();
  });
});
