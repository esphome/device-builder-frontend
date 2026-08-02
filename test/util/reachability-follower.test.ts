/** Pins the shared reachability follower's subscribe lifecycle. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flush, flushTimers } from "../_dom.js";
import { FakeHost } from "../_fake-host.js";
import { makeReachabilityEvent } from "../_make-reachability-event.js";
import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import type { ReachabilityStateEvent } from "../../src/api/types/reachability.js";
import {
  ReachabilityFollower,
  type ReachabilityFollowerOptions,
} from "../../src/util/reachability-follower.js";

function makeApi(
  overrides: Record<string, unknown> = {},
  generation: { value: number } = { value: 1 }
) {
  const unsubscribe = vi.fn().mockResolvedValue(undefined);
  const api = {
    get connectionGeneration() {
      return generation.value;
    },
    subscribeDeviceReachability: vi.fn().mockResolvedValue({ unsubscribe }),
    ...overrides,
  };
  return { api: api as unknown as ESPHomeAPI, unsubscribe };
}

function makeFollower(
  api: ESPHomeAPI | undefined,
  overrides: Partial<ReachabilityFollowerOptions> = {}
) {
  const events: ReachabilityStateEvent[] = [];
  const onTeardown = vi.fn();
  const host = new FakeHost();
  let name: string | null = "kitchen";
  const follower = new ReachabilityFollower(host, {
    api: () => api,
    deviceName: () => name,
    onEvent: (state) => events.push(state),
    onTeardown,
    tickRender: true,
    ...overrides,
  });
  return {
    follower,
    events,
    host,
    onTeardown,
    setName: (n: string | null) => {
      name = n;
    },
  };
}

describe("ReachabilityFollower", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("subscribes on reconcile and delivers events", async () => {
    const { api } = makeApi();
    const { follower, events } = makeFollower(api);
    follower.reconcile();
    await flush();
    const sub = api.subscribeDeviceReachability as ReturnType<typeof vi.fn>;
    expect(sub).toHaveBeenCalledWith("kitchen", expect.any(Function));
    const callback = sub.mock.calls[0][1];
    const event = makeReachabilityEvent();
    callback(event);
    expect(events).toEqual([event]);
    follower.stop();
  });

  it("same-target reconcile no-ops while an attempt is in flight", async () => {
    let resolveSub!: (v: { unsubscribe: () => Promise<void> }) => void;
    const { api } = makeApi({
      subscribeDeviceReachability: vi.fn().mockReturnValue(
        new Promise((r) => {
          resolveSub = r;
        })
      ),
    });
    const { follower } = makeFollower(api);
    follower.reconcile();
    follower.reconcile();
    expect(api.subscribeDeviceReachability).toHaveBeenCalledTimes(1);
    resolveSub({ unsubscribe: vi.fn().mockResolvedValue(undefined) });
    await flush();
    follower.reconcile();
    expect(api.subscribeDeviceReachability).toHaveBeenCalledTimes(1);
    follower.stop();
  });

  it("a stale resolve unsubscribes itself and drops its events", async () => {
    let resolveSub!: (v: { unsubscribe: () => Promise<void> }) => void;
    const staleUnsub = vi.fn().mockResolvedValue(undefined);
    const { api } = makeApi({
      subscribeDeviceReachability: vi.fn().mockReturnValue(
        new Promise((r) => {
          resolveSub = r;
        })
      ),
    });
    const { follower, events, setName } = makeFollower(api);
    follower.reconcile();
    const callback = (api.subscribeDeviceReachability as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    setName(null);
    follower.reconcile();
    resolveSub({ unsubscribe: staleUnsub });
    await flush();
    expect(staleUnsub).toHaveBeenCalledOnce();
    callback(makeReachabilityEvent());
    expect(events).toEqual([]);
  });

  it("memoizes a failed (device, generation) and warns once", async () => {
    const { api } = makeApi({
      subscribeDeviceReachability: vi.fn().mockRejectedValue(new Error("nope")),
    });
    const { follower } = makeFollower(api);
    follower.reconcile();
    await flush();
    follower.reconcile();
    follower.reconcile();
    await flush();
    expect(api.subscribeDeviceReachability).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    follower.stop();
  });

  it("a generation bump retries a failed subscribe and rotates the stream", async () => {
    const generation = { value: 1 };
    const { api, unsubscribe } = makeApi({}, generation);
    const { follower } = makeFollower(api);
    follower.reconcile();
    await flush();
    expect(api.subscribeDeviceReachability).toHaveBeenCalledTimes(1);
    generation.value = 2;
    follower.reconcile();
    await flush();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(api.subscribeDeviceReachability).toHaveBeenCalledTimes(2);
    follower.stop();
  });

  it("a success resets the warn memo for a later genuine re-failure", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const { api } = makeApi({
      subscribeDeviceReachability: vi
        .fn()
        .mockRejectedValueOnce(new Error("first failure"))
        .mockResolvedValueOnce({ unsubscribe })
        .mockRejectedValueOnce(new Error("re-failure")),
    });
    const { follower, setName } = makeFollower(api);
    follower.reconcile();
    await flush();
    expect(console.warn).toHaveBeenCalledTimes(1);
    follower.retry();
    follower.reconcile();
    await flush();
    setName(null);
    follower.reconcile();
    setName("kitchen");
    follower.reconcile();
    await flush();
    // Same name:generation key as the first failure; the success in
    // between must have released its one warn slot.
    expect(console.warn).toHaveBeenCalledTimes(2);
    follower.stop();
  });

  it("retry clears the failure memo so reconcile attempts again", async () => {
    const { api } = makeApi({
      subscribeDeviceReachability: vi.fn().mockRejectedValue(new Error("nope")),
    });
    const { follower } = makeFollower(api);
    follower.reconcile();
    await flush();
    follower.retry();
    follower.reconcile();
    await flush();
    expect(api.subscribeDeviceReachability).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(2);
    follower.stop();
  });

  it("an idle target tears down, notifies, and disarms the interval", async () => {
    vi.useFakeTimers();
    const { api, unsubscribe } = makeApi();
    const { follower, host, onTeardown, setName } = makeFollower(api);
    follower.reconcile();
    await flushTimers();
    await vi.advanceTimersByTimeAsync(2000);
    // tickRender requests a host render each tick.
    expect(host.updates).toBe(2);
    setName(null);
    follower.reconcile();
    await flushTimers();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(onTeardown).toHaveBeenCalledOnce();
    const settled = host.updates;
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.updates).toBe(settled);
  });

  it("hostDisconnected stops the stream and the tick", async () => {
    vi.useFakeTimers();
    const { api, unsubscribe } = makeApi();
    const { follower, host } = makeFollower(api);
    follower.reconcile();
    await flushTimers();
    follower.hostDisconnected();
    expect(unsubscribe).toHaveBeenCalledOnce();
    const settled = host.updates;
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.updates).toBe(settled);
  });

  it("the tick reconciles, recovering from a WS reconnect", async () => {
    vi.useFakeTimers();
    const generation = { value: 1 };
    const { api } = makeApi({}, generation);
    const { follower } = makeFollower(api);
    follower.reconcile();
    await flushTimers();
    expect(api.subscribeDeviceReachability).toHaveBeenCalledTimes(1);
    generation.value = 2;
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.subscribeDeviceReachability).toHaveBeenCalledTimes(2);
    follower.stop();
  });

  it("no api means idle: no interval arms and no render is requested", async () => {
    vi.useFakeTimers();
    const { follower, host } = makeFollower(undefined);
    follower.reconcile();
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.updates).toBe(0);
    follower.stop();
  });

  it("teardown-then-resubscribe onto the same target keeps exactly one stream", async () => {
    const resolvers: Array<(v: { unsubscribe: () => Promise<void> }) => void> = [];
    const unsubs = [
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockResolvedValue(undefined),
    ];
    const { api } = makeApi({
      subscribeDeviceReachability: vi.fn().mockImplementation(
        () =>
          new Promise((r) => {
            resolvers.push(r);
          })
      ),
    });
    const { follower, events, setName } = makeFollower(api);
    follower.reconcile();
    const firstCallback = (api.subscribeDeviceReachability as ReturnType<typeof vi.fn>)
      .mock.calls[0][1];
    // Same (name, generation) recurs within one round-trip; only the
    // attempt id tells the two apart.
    setName(null);
    follower.reconcile();
    setName("kitchen");
    follower.reconcile();
    expect(api.subscribeDeviceReachability).toHaveBeenCalledTimes(2);
    resolvers[0]({ unsubscribe: unsubs[0] });
    resolvers[1]({ unsubscribe: unsubs[1] });
    await flush();
    expect(unsubs[0]).toHaveBeenCalledOnce();
    expect(unsubs[1]).not.toHaveBeenCalled();
    firstCallback(makeReachabilityEvent());
    expect(events).toEqual([]);
    follower.stop();
    expect(unsubs[1]).toHaveBeenCalledOnce();
  });

  it("a stale rejection stays silent and leaves the memos alone", async () => {
    let reject!: (err: Error) => void;
    const { api } = makeApi({
      subscribeDeviceReachability: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((_r, rej) => {
              reject = rej;
            })
        )
        .mockRejectedValue(new Error("real failure")),
    });
    const { follower, setName } = makeFollower(api);
    follower.reconcile();
    setName(null);
    follower.reconcile();
    reject(new Error("stale failure"));
    await flush();
    expect(console.warn).not.toHaveBeenCalled();
    // The key is unpoisoned: the same target failing for real warns.
    setName("kitchen");
    follower.reconcile();
    await flush();
    expect(console.warn).toHaveBeenCalledTimes(1);
    follower.stop();
  });

  it("hostConnected and hostUpdated drive reconcile without host plumbing", async () => {
    const { api } = makeApi();
    const { follower, setName } = makeFollower(api);
    follower.hostConnected();
    await flush();
    expect(api.subscribeDeviceReachability).toHaveBeenCalledTimes(1);
    setName("garage");
    follower.hostUpdated();
    await flush();
    expect(api.subscribeDeviceReachability).toHaveBeenLastCalledWith(
      "garage",
      expect.any(Function)
    );
    follower.stop();
  });
});
