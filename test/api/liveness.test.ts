import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "../../src/api/api-error.js";
import { LivenessMonitor } from "../../src/api/liveness.js";
import {
  MockWebSocket,
  fireDocumentEvent,
  fireWindowEvent,
  installMockWebSocket,
  setDocumentVisibility,
  uninstallMockWebSocket,
} from "./mock-websocket.js";

type Hooks = {
  getSocket: Mock<() => WebSocket | null>;
  ping: Mock<(timeoutMs: number) => Promise<unknown>>;
  onDead: Mock<(ws: WebSocket) => void>;
  onOnline: Mock<() => void>;
};

function makeMonitor(overrides: Partial<Hooks> = {}) {
  const socket = { readyState: MockWebSocket.OPEN } as unknown as WebSocket;
  const hooks: Hooks = {
    getSocket: vi.fn<() => WebSocket | null>(() => socket),
    ping: vi.fn<(timeoutMs: number) => Promise<unknown>>(() => new Promise(() => {})),
    onDead: vi.fn<(ws: WebSocket) => void>(),
    onOnline: vi.fn<() => void>(),
    ...overrides,
  };
  return { monitor: new LivenessMonitor(hooks), hooks, socket };
}

describe("LivenessMonitor", () => {
  beforeEach(() => {
    // Installs the WebSocket global too: the monitor's tick reads
    // WebSocket.OPEN, which bare node runs may not define.
    installMockWebSocket();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    uninstallMockWebSocket();
  });

  it("pings only after the silence threshold", async () => {
    const { monitor, hooks } = makeMonitor();
    monitor.startHeartbeat();
    await vi.advanceTimersByTimeAsync(10000);
    expect(hooks.ping).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(hooks.ping).toHaveBeenCalledTimes(1);
    monitor.stopHeartbeat();
  });

  it("noteMessage resets the silence clock", async () => {
    const { monitor, hooks } = makeMonitor();
    monitor.startHeartbeat();
    await vi.advanceTimersByTimeAsync(10000);
    monitor.noteMessage();
    await vi.advanceTimersByTimeAsync(10000);
    expect(hooks.ping).not.toHaveBeenCalled();
    monitor.stopHeartbeat();
  });

  it("keeps pings non-overlapping while one is in flight", async () => {
    const { monitor, hooks } = makeMonitor();
    monitor.startHeartbeat();
    await vi.advanceTimersByTimeAsync(30000);
    expect(hooks.ping).toHaveBeenCalledTimes(1);
    monitor.stopHeartbeat();
  });

  it("stops ticking after stopHeartbeat", async () => {
    const { monitor, hooks } = makeMonitor({
      ping: vi.fn<(timeoutMs: number) => Promise<unknown>>(() => Promise.resolve()),
    });
    monitor.startHeartbeat();
    await vi.advanceTimersByTimeAsync(15000);
    expect(hooks.ping).toHaveBeenCalledTimes(1);
    monitor.stopHeartbeat();
    await vi.advanceTimersByTimeAsync(60000);
    expect(hooks.ping).toHaveBeenCalledTimes(1);
  });

  it("calls onDead on a ping rejection that is not an APIError", async () => {
    const { monitor, hooks, socket } = makeMonitor({
      ping: vi.fn(() => Promise.reject(new Error("timed out"))),
    });
    monitor.startHeartbeat();
    await vi.advanceTimersByTimeAsync(15000);
    expect(hooks.onDead).toHaveBeenCalledWith(socket);
    monitor.stopHeartbeat();
  });

  it("treats an APIError reply as proof of liveness", async () => {
    const { monitor, hooks } = makeMonitor({
      ping: vi.fn(() => Promise.reject(new APIError("not_authenticated", "nope"))),
    });
    monitor.startHeartbeat();
    await vi.advanceTimersByTimeAsync(15000);
    expect(hooks.onDead).not.toHaveBeenCalled();
    monitor.stopHeartbeat();
  });

  it("skips onDead when the socket was already replaced", async () => {
    let rejectPing!: (err: Error) => void;
    const { monitor, hooks } = makeMonitor({
      ping: vi.fn(() => new Promise((_, reject) => (rejectPing = reject))),
    });
    monitor.startHeartbeat();
    await vi.advanceTimersByTimeAsync(15000);
    hooks.getSocket.mockReturnValue({
      readyState: MockWebSocket.OPEN,
    } as unknown as WebSocket);
    rejectPing(new Error("timed out"));
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.onDead).not.toHaveBeenCalled();
    // The positive control: the catch handler ran and re-read the
    // socket, so the missing onDead is the guard, not an undrained
    // rejection.
    expect(hooks.getSocket).toHaveBeenCalledTimes(2);
    monitor.stopHeartbeat();
  });

  it("does not probe a socket that is not OPEN", async () => {
    const { monitor, hooks } = makeMonitor({
      getSocket: vi.fn(
        () => ({ readyState: MockWebSocket.CONNECTING }) as unknown as WebSocket
      ),
    });
    monitor.startHeartbeat();
    await vi.advanceTimersByTimeAsync(30000);
    expect(hooks.ping).not.toHaveBeenCalled();
    monitor.stopHeartbeat();
  });

  it("skips ticks while the tab is hidden and catches up on the visibility edge", async () => {
    const { monitor, hooks } = makeMonitor();
    monitor.registerNetworkListeners();
    monitor.startHeartbeat();
    setDocumentVisibility("hidden");
    await vi.advanceTimersByTimeAsync(60000);
    expect(hooks.ping).not.toHaveBeenCalled();
    setDocumentVisibility("visible");
    fireDocumentEvent("visibilitychange");
    expect(hooks.ping).toHaveBeenCalledTimes(1);
    monitor.stopHeartbeat();
    monitor.unregisterNetworkListeners();
  });

  it("routes the offline event to onDead with the current socket", () => {
    const { monitor, hooks, socket } = makeMonitor();
    monitor.registerNetworkListeners();
    fireWindowEvent("offline");
    expect(hooks.onDead).toHaveBeenCalledWith(socket);
    monitor.unregisterNetworkListeners();
  });

  it("ignores the offline event with no socket", () => {
    const { monitor, hooks } = makeMonitor({ getSocket: vi.fn(() => null) });
    monitor.registerNetworkListeners();
    fireWindowEvent("offline");
    expect(hooks.onDead).not.toHaveBeenCalled();
    monitor.unregisterNetworkListeners();
  });

  it("routes the online event to onOnline", () => {
    const { monitor, hooks } = makeMonitor();
    monitor.registerNetworkListeners();
    fireWindowEvent("online");
    expect(hooks.onOnline).toHaveBeenCalledTimes(1);
    monitor.unregisterNetworkListeners();
  });

  it("stops dispatch after unregisterNetworkListeners", () => {
    const { monitor } = makeMonitor();
    monitor.registerNetworkListeners();
    monitor.unregisterNetworkListeners();
    expect(() => fireWindowEvent("offline")).toThrow(/no window listeners/);
  });
});
