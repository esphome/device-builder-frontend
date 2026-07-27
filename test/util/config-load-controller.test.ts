import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactiveController } from "lit";
import { APIError } from "../../src/api/api-error.js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { ConfigLoadController } from "../../src/util/config-load-controller.js";
import { flushMicrotasks } from "../_dom.js";

/**
 * Pins the shared load ladder: start vs refresh semantics, server-reply
 * routing, supersession, and the reconnect re-run.
 */

class FakeHost {
  private _controllers: ReactiveController[] = [];
  addController(c: ReactiveController) {
    this._controllers.push(c);
  }
  removeController() {}
  requestUpdate() {}
  updateComplete = Promise.resolve(true);
  connect() {
    for (const c of this._controllers) c.hostConnected?.();
  }
  update() {
    for (const c of this._controllers) c.hostUpdated?.();
  }
  disconnect() {
    for (const c of this._controllers) c.hostDisconnected?.();
  }
}

function makeApi(getConfig: ReturnType<typeof vi.fn>): ESPHomeAPI {
  return { ready: Promise.resolve(), getConfig } as unknown as ESPHomeAPI;
}

function makeLoad(overrides: {
  getConfig: ReturnType<typeof vi.fn>;
  configuration?: () => string;
  connected?: () => boolean;
  onApiError?: (err: APIError) => { seed: string } | "missing" | undefined;
  onRefreshFailed?: () => void;
  onReady?: () => void;
}) {
  const host = new FakeHost();
  const commit = vi.fn();
  const controller = new ConfigLoadController(host, {
    api: () => makeApi(overrides.getConfig),
    connected: overrides.connected ?? (() => true),
    configuration: overrides.configuration ?? (() => "kitchen.yaml"),
    attempts: 1,
    commit,
    onReady: overrides.onReady,
    onApiError: overrides.onApiError,
    onRefreshFailed: overrides.onRefreshFailed,
  });
  host.connect();
  return { host, controller, commit };
}

describe("ConfigLoadController", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("commits a loaded config and flips to ready, then onReady", async () => {
    const order: string[] = [];
    const { controller, commit } = makeLoad({
      getConfig: vi.fn().mockResolvedValue("yaml"),
      onReady: () => order.push("ready-hook"),
    });
    commit.mockImplementation(() => order.push("commit"));

    await controller.start();

    expect(commit).toHaveBeenCalledWith("yaml");
    expect(controller.state).toBe("ready");
    expect(order).toEqual(["commit", "ready-hook"]);
  });

  it("a failed start lands in the error state", async () => {
    const { controller } = makeLoad({
      getConfig: vi.fn().mockRejectedValue(new Error("WebSocket closed")),
    });
    await controller.start();
    expect(controller.state).toBe("error");
  });

  it("a failed refresh over a ready buffer keeps it rendered and notifies", async () => {
    const onRefreshFailed = vi.fn();
    const getConfig = vi.fn().mockResolvedValueOnce("yaml");
    const { controller, commit } = makeLoad({ getConfig, onRefreshFailed });
    await controller.start();

    getConfig.mockRejectedValueOnce(new Error("WebSocket closed"));
    await controller.refresh();

    expect(controller.state).toBe("ready");
    expect(onRefreshFailed).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("a failed refresh with nothing rendered still errors", async () => {
    const onRefreshFailed = vi.fn();
    const { controller } = makeLoad({
      getConfig: vi.fn().mockRejectedValue(new Error("WebSocket closed")),
      onRefreshFailed,
    });
    await controller.refresh();
    expect(controller.state).toBe("error");
    expect(onRefreshFailed).not.toHaveBeenCalled();
  });

  it("routes a seeding server reply to a ready commit", async () => {
    const { controller, commit } = makeLoad({
      getConfig: vi.fn().mockRejectedValue(new APIError("not_found", "missing")),
      onApiError: () => ({ seed: "# header\n" }),
    });
    await controller.start();
    expect(commit).toHaveBeenCalledWith("# header\n");
    expect(controller.state).toBe("ready");
    // The seed is a first-run outcome, not a failure; it stays log-free.
    expect(console.error).not.toHaveBeenCalled();
  });

  it("parks terminally on a missing reply; a reconnect leaves it alone", async () => {
    let connected = true;
    const { host, controller } = makeLoad({
      getConfig: vi.fn().mockRejectedValue(new APIError("not_found", "gone")),
      connected: () => connected,
      onApiError: () => "missing",
    });
    await controller.start();
    expect(controller.state).toBe("missing");
    // The terminal panel doesn't name the file; the console entry does.
    expect(console.error).toHaveBeenCalledWith(
      "Failed to load kitchen.yaml:",
      expect.any(APIError)
    );

    connected = false;
    host.update();
    connected = true;
    host.update();
    await flushMicrotasks(4);
    // A server answer is final; only the error state re-runs.
    expect(controller.state).toBe("missing");
  });

  it("does not treat the initial connected state as a reconnect edge", async () => {
    const getConfig = vi.fn().mockRejectedValue(new Error("WebSocket closed"));
    const { host, controller } = makeLoad({ getConfig });
    await controller.start();
    expect(controller.state).toBe("error");

    host.update();
    await flushMicrotasks(4);
    // The socket was up the whole time — no edge, no extra retry.
    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(controller.state).toBe("error");
  });

  it("re-runs a failed load on the reconnect edge", async () => {
    let connected = true;
    const getConfig = vi.fn().mockRejectedValueOnce(new Error("WebSocket closed"));
    const { host, controller } = makeLoad({ getConfig, connected: () => connected });
    await controller.start();
    expect(controller.state).toBe("error");

    getConfig.mockResolvedValueOnce("yaml");
    connected = false;
    host.update();
    connected = true;
    host.update();
    await flushMicrotasks(4);

    expect(controller.state).toBe("ready");
  });

  it("drops a reply that lands after the host disconnected", async () => {
    let settle!: (yaml: string) => void;
    const getConfig = vi.fn(() => new Promise<string>((r) => (settle = r)));
    const { host, controller, commit } = makeLoad({ getConfig });

    const load = controller.start();
    await flushMicrotasks(2);
    host.disconnect();
    settle("late");
    await load;

    // The page is gone; a late reply must not write into its buffers.
    expect(commit).not.toHaveBeenCalled();
  });

  it("drops a reply for a configuration the host moved past", async () => {
    let configuration = "a.yaml";
    let settle!: (yaml: string) => void;
    const getConfig = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((r) => (settle = r)))
      .mockImplementation(() => new Promise<string>(() => {}));
    const { controller, commit } = makeLoad({
      getConfig,
      configuration: () => configuration,
    });

    const first = controller.start();
    // Let the first load reach its getConfig before the host moves on.
    await flushMicrotasks(2);
    configuration = "b.yaml";
    void controller.start();
    settle("stale");
    await first;

    expect(commit).not.toHaveBeenCalled();
    expect(controller.state).toBe("loading");
  });

  it("a superseded load never commits over the newer one", async () => {
    let settleFirst!: (yaml: string) => void;
    const getConfig = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((r) => (settleFirst = r)))
      .mockResolvedValueOnce("fresh");
    const { controller, commit } = makeLoad({ getConfig });

    const first = controller.start();
    await flushMicrotasks(2);
    await controller.start();
    settleFirst("stale");
    await first;

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("fresh");
  });
});
