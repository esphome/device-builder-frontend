import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ESPHomeAPI } from "../../src/api/esphome-api.js";
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

describe("ESPHomeAPI — connection", () => {
  beforeEach(() => {
    installMockWebSocket();
  });
  afterEach(() => {
    uninstallMockWebSocket();
  });

  it("opens a ws:// URL from the page location", async () => {
    const api = new ESPHomeAPI();
    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfo);
    await pending;
    expect(ws.url).toBe("ws://localhost:8000/ws");
  });

  it("upgrades to wss:// when the page is https", async () => {
    (globalThis as unknown as { window: { location: { protocol: string; host: string } } }).window =
      { location: { protocol: "https:", host: "example.test" } };
    const api = new ESPHomeAPI();
    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfo);
    await pending;
    expect(ws.url).toBe("wss://example.test/ws");
  });

  it("resolves with server info and fires onConnected", async () => {
    const api = new ESPHomeAPI();
    const onConnected = vi.fn();
    api.onConnected = onConnected;
    const ws = await connect(api);
    expect(api.connected).toBe(true);
    expect(api.serverInfo).toEqual(serverInfo);
    expect(onConnected).toHaveBeenCalledWith(serverInfo);
    expect(ws).toBeDefined();
  });

  it("returns the existing server info when already connected", async () => {
    const api = new ESPHomeAPI();
    await connect(api);
    const second = await api.connect();
    expect(second).toEqual(serverInfo);
  });

  it("rejects connect() on transport error", async () => {
    const api = new ESPHomeAPI();
    const pending = api.connect();
    MockWebSocket.latest().triggerError();
    await expect(pending).rejects.toThrow(/WebSocket connection failed/);
  });

  it("does not fire onDisconnected if connect never succeeded", async () => {
    const api = new ESPHomeAPI();
    const onDisconnected = vi.fn();
    api.onDisconnected = onDisconnected;
    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.triggerError();
    await expect(pending).rejects.toThrow();
    ws.close();
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it("fires onDisconnected when an established connection closes", async () => {
    const api = new ESPHomeAPI();
    const onDisconnected = vi.fn();
    api.onDisconnected = onDisconnected;
    const ws = await connect(api);
    ws.close();
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(api.connected).toBe(false);
  });
});

describe("ESPHomeAPI — sendCommand", () => {
  beforeEach(() => {
    installMockWebSocket();
  });
  afterEach(() => {
    uninstallMockWebSocket();
    vi.useRealTimers();
  });

  it("sends a command with a message_id and resolves the result", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);

    const pending = api.sendCommand<{ ok: boolean }>("ping", { foo: "bar" });
    const sent = ws.sentAs<{ command: string; message_id: string; args?: unknown }>(0);
    expect(sent.command).toBe("ping");
    expect(sent.args).toEqual({ foo: "bar" });
    expect(sent.message_id).toBeTruthy();

    ws.receive({ message_id: sent.message_id, result: { ok: true } });
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("omits args when none are given", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    api.sendCommand("ping");
    const sent = ws.sentAs<{ args?: unknown }>(0);
    expect(sent.args).toBeUndefined();
  });

  it("rejects with the error_code + details on ErrorMessage", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.sendCommand("boom");
    const { message_id } = ws.sentAs<{ message_id: string }>(0);
    ws.receive({ message_id, error_code: "not_found", details: "no such cmd" });
    await expect(pending).rejects.toThrow(/not_found.*no such cmd/);
  });

  it("rejects when no response arrives before the timeout", async () => {
    vi.useFakeTimers();
    const api = new ESPHomeAPI();
    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfo);
    await pending;

    const cmd = api.sendCommand("slow", undefined, 500);
    vi.advanceTimersByTime(500);
    await expect(cmd).rejects.toThrow(/timed out after 500ms/);
  });

  it("throws when the socket is not open", async () => {
    const api = new ESPHomeAPI();
    await expect(api.sendCommand("ping")).rejects.toThrow(
      /not connected/,
    );
  });

  it("assigns sequential message_ids", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    api.sendCommand("a");
    api.sendCommand("b");
    const id0 = ws.sentAs<{ message_id: string }>(0).message_id;
    const id1 = ws.sentAs<{ message_id: string }>(1).message_id;
    expect(Number(id1)).toBe(Number(id0) + 1);
  });

  it("rejects all pending requests when the socket closes", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.sendCommand("ping");
    ws.close();
    await expect(pending).rejects.toThrow(/WebSocket connection closed/);
  });
});

describe("ESPHomeAPI — streaming commands", () => {
  beforeEach(() => {
    installMockWebSocket();
  });
  afterEach(() => {
    uninstallMockWebSocket();
  });

  it("delivers output events to onOutput", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const onOutput = vi.fn();
    const onResult = vi.fn();
    const messageId = api.sendStreamCommand(
      "devices/validate",
      { configuration: "foo.yaml" },
      { onOutput, onResult },
    );
    ws.receive({ message_id: messageId, event: "output", data: "line 1" });
    ws.receive({ message_id: messageId, event: "output", data: "line 2" });
    expect(onOutput).toHaveBeenNthCalledWith(1, "line 1");
    expect(onOutput).toHaveBeenNthCalledWith(2, "line 2");
    expect(onResult).not.toHaveBeenCalled();
  });

  it("delivers result events and stops listening afterwards", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const onOutput = vi.fn();
    const onResult = vi.fn();
    const messageId = api.sendStreamCommand(
      "devices/validate",
      { configuration: "foo.yaml" },
      { onOutput, onResult },
    );
    ws.receive({
      message_id: messageId,
      event: "result",
      data: { success: true, code: 0 },
    });
    expect(onResult).toHaveBeenCalledWith({ success: true, code: 0 });

    ws.receive({ message_id: messageId, event: "output", data: "ignored" });
    expect(onOutput).not.toHaveBeenCalled();
  });

  it("routes ErrorMessage to the stream's onError", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const onError = vi.fn();
    const messageId = api.sendStreamCommand(
      "devices/validate",
      { configuration: "foo.yaml" },
      { onError },
    );
    ws.receive({
      message_id: messageId,
      error_code: "internal_error",
      details: "kaboom",
    });
    expect(onError).toHaveBeenCalledWith("kaboom");
  });

  it("calls onError with connection-closed when the socket drops", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const onError = vi.fn();
    api.sendStreamCommand("devices/logs", { configuration: "foo.yaml" }, { onError });
    ws.close();
    expect(onError).toHaveBeenCalledWith("WebSocket connection closed");
  });

  it("stopStream sends devices/stop_stream with the stream id", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);

    // Start a streaming command so we have a message_id worth cancelling.
    const streamId = api.sendStreamCommand(
      "devices/logs",
      { configuration: "foo.yaml", port: "" },
      { onOutput: vi.fn(), onResult: vi.fn() },
    );

    const pending = api.stopStream(streamId);
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: { stream_id: string };
    }>(1);
    expect(sent.command).toBe("devices/stop_stream");
    expect(sent.args).toEqual({ stream_id: streamId });

    ws.receive({ message_id: sent.message_id, result: { cancelled: true } });
    await expect(pending).resolves.toEqual({ cancelled: true });
  });

  it("stopStream drops the local handler so further output events are ignored", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const onOutput = vi.fn();
    const onResult = vi.fn();

    const streamId = api.sendStreamCommand(
      "devices/logs",
      { configuration: "foo.yaml", port: "" },
      { onOutput, onResult },
    );

    // Pre-stop: events flow normally.
    ws.receive({ message_id: streamId, event: "output", data: "before-stop" });
    expect(onOutput).toHaveBeenCalledWith("before-stop");

    api.stopStream(streamId);

    // Anything that arrives after stop — whether genuinely racing or a
    // misbehaving backend that keeps sending — must not reach the caller.
    ws.receive({ message_id: streamId, event: "output", data: "after-stop" });
    ws.receive({
      message_id: streamId,
      event: "result",
      data: { success: false, code: -1 },
    });

    expect(onOutput).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
  });

  it("signals an error via onError if send is attempted while disconnected", () => {
    const api = new ESPHomeAPI();
    const onError = vi.fn();
    const id = api.sendStreamCommand("x", {}, { onError });
    expect(id).toBe("");
    expect(onError).toHaveBeenCalledWith("WebSocket not connected");
  });
});

describe("ESPHomeAPI — event subscriptions", () => {
  beforeEach(() => {
    installMockWebSocket();
  });
  afterEach(() => {
    uninstallMockWebSocket();
  });

  it("confirms the subscription via a result and then forwards events", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const received: Array<{ event: string; data: unknown }> = [];
    const subscribed = api.subscribeEvents((event, data) =>
      received.push({ event, data }),
    );
    const msgId = ws.sentAs<{ message_id: string }>(0).message_id;
    ws.receive({ message_id: msgId, result: { subscribed: true } });
    await subscribed;

    ws.receive({
      message_id: msgId,
      event: "device_added",
      data: { configuration: "foo.yaml" },
    });
    expect(received).toEqual([
      { event: "device_added", data: { configuration: "foo.yaml" } },
    ]);
  });
});

describe("ESPHomeAPI — typed command wrappers", () => {
  beforeEach(() => {
    installMockWebSocket();
  });
  afterEach(() => {
    uninstallMockWebSocket();
  });

  it("listDevices sends devices/list and unwraps the result", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const payload = { configured: [], importable: [] };
    const pending = api.listDevices();
    const sent = ws.sentAs<{ command: string; message_id: string; args?: unknown }>(0);
    expect(sent.command).toBe("devices/list");
    expect(sent.args).toBeUndefined();
    ws.receive({ message_id: sent.message_id, result: payload });
    await expect(pending).resolves.toEqual(payload);
  });

  it("addComponent merges configuration into args", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.addComponent("foo.yaml", {
      component_id: "dht",
      fields: { pin: "GPIO4" },
    });
    const sent = ws.sentAs<{ command: string; message_id: string; args: Record<string, unknown> }>(0);
    expect(sent.command).toBe("devices/add_component");
    expect(sent.args).toEqual({
      configuration: "foo.yaml",
      component_id: "dht",
      fields: { pin: "GPIO4" },
    });
    ws.receive({ message_id: sent.message_id, result: { yaml: "..." } });
    await pending;
  });

  it("firmwareInstall defaults port to OTA", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    api.firmwareInstall("foo.yaml");
    const sent = ws.sentAs<{ args: Record<string, unknown> }>(0);
    expect(sent.args).toEqual({ configuration: "foo.yaml", port: "OTA" });
  });

  it("validate sends devices/validate through the stream API", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const id = api.validate("foo.yaml", { onOutput: () => {} });
    expect(id).toBeTruthy();
    const sent = ws.sentAs<{ command: string; args: Record<string, unknown> }>(0);
    expect(sent.command).toBe("devices/validate");
    expect(sent.args).toEqual({ configuration: "foo.yaml" });
  });

  it("updatePreferences passes the partial prefs as args", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    api.updatePreferences({ theme: "dark" as never });
    const sent = ws.sentAs<{ command: string; args: Record<string, unknown> }>(0);
    expect(sent.command).toBe("config/set_preferences");
    expect(sent.args).toEqual({ theme: "dark" });
  });
});
