import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { APIError } from "../../src/api/api-error.js";
import { ESPHomeAPI } from "../../src/api/esphome-api.js";
import { JobType } from "../../src/api/types.js";
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

const serverInfoAuthRequired = {
  ...serverInfo,
  requires_auth: true,
};

function stubLocalStorage(initial?: Record<string, string>): Map<string, string> {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
  return store;
}

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

  it("rejects with an APIError carrying error_code + details", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.sendCommand("boom");
    const { message_id } = ws.sentAs<{ message_id: string }>(0);
    ws.receive({ message_id, error_code: "not_found", details: "no such cmd" });
    // Existing string-match contract preserved for log scrapers.
    await expect(pending).rejects.toThrow(/not_found.*no such cmd/);

    // Structured fields available on the error so callers can branch
    // on error_code without re-parsing the message.
    const second = api.sendCommand("boom2");
    const id2 = ws.sentAs<{ message_id: string }>(1).message_id;
    ws.receive({ message_id: id2, error_code: "not_found", details: "gone" });
    try {
      await second;
      throw new Error("should have rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).errorCode).toBe("not_found");
      expect((err as APIError).details).toBe("gone");
    }
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

describe("ESPHomeAPI — cloneDevice", () => {
  beforeEach(() => {
    installMockWebSocket();
  });
  afterEach(() => {
    uninstallMockWebSocket();
  });

  it("sends ``devices/clone`` with snake_case args and returns the new configuration", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);

    const pending = api.cloneDevice(
      "kitchen.yaml",
      "bedroom-bulb",
      "Bedroom Reading Lamp",
    );
    const sent = ws.sentAs<{ command: string; args: Record<string, unknown> }>(0);

    expect(sent.command).toBe("devices/clone");
    expect(sent.args).toEqual({
      configuration: "kitchen.yaml",
      new_name: "bedroom-bulb",
      new_friendly_name: "Bedroom Reading Lamp",
    });

    ws.receive({
      message_id: ws.sentAs<{ message_id: string }>(0).message_id,
      result: { configuration: "bedroom-bulb.yaml" },
    });
    await expect(pending).resolves.toEqual({ configuration: "bedroom-bulb.yaml" });
  });

  it("omits ``new_friendly_name`` when the caller doesn't pass one", async () => {
    // The backend defaults to ``friendly_name_slugify(new_name)``
    // when the field is missing — sending an empty string instead
    // would tell the backend to leave the source's
    // ``friendly_name:`` line untouched, producing two list
    // entries with the same label. Pin that the helper omits the
    // key entirely on ``undefined`` so the default kicks in.
    const api = new ESPHomeAPI();
    const ws = await connect(api);

    api.cloneDevice("kitchen.yaml", "bedroom-bulb");
    const sent = ws.sentAs<{ args: Record<string, unknown> }>(0);

    expect(sent.args).toEqual({
      configuration: "kitchen.yaml",
      new_name: "bedroom-bulb",
    });
    expect("new_friendly_name" in sent.args).toBe(false);
  });

  it("forwards an explicit empty friendly name so the source's label is preserved", async () => {
    // Edge case: a caller that *wants* the clone to share the
    // source's ``friendly_name:`` line (rare but supported)
    // passes ``""`` explicitly. Pin that the helper sends
    // ``new_friendly_name: ""`` on the wire so the backend's
    // ``if new_friendly_name:`` short-circuit fires and the
    // rewrite is skipped.
    const api = new ESPHomeAPI();
    const ws = await connect(api);

    api.cloneDevice("kitchen.yaml", "bedroom-bulb", "");
    const sent = ws.sentAs<{ args: Record<string, unknown> }>(0);

    expect(sent.args).toEqual({
      configuration: "kitchen.yaml",
      new_name: "bedroom-bulb",
      new_friendly_name: "",
    });
  });
});

describe("ESPHomeAPI — editFriendlyName", () => {
  beforeEach(() => {
    installMockWebSocket();
  });
  afterEach(() => {
    uninstallMockWebSocket();
  });

  it("sends ``devices/edit_friendly_name`` with snake_case args", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);

    const pending = api.editFriendlyName("kitchen.yaml", "Reading Lamp");
    const sent = ws.sentAs<{ command: string; args: Record<string, unknown> }>(0);

    expect(sent.command).toBe("devices/edit_friendly_name");
    expect(sent.args).toEqual({
      configuration: "kitchen.yaml",
      new_friendly_name: "Reading Lamp",
    });

    ws.receive({
      message_id: ws.sentAs<{ message_id: string }>(0).message_id,
      result: { configuration: "kitchen.yaml", rewritten: true },
    });
    await expect(pending).resolves.toEqual({
      configuration: "kitchen.yaml",
      rewritten: true,
    });
  });

  it("propagates the rewritten=false signal for an idempotent edit", async () => {
    // The command is idempotent on the backend — submitting the
    // same value the leaf already has skips the write and returns
    // ``rewritten: false`` so the caller knows to skip the
    // follow-up install. Pin that the helper passes the flag
    // through unchanged so the dashboard handler can branch on it.
    const api = new ESPHomeAPI();
    const ws = await connect(api);

    const pending = api.editFriendlyName("kitchen.yaml", "Kitchen");
    ws.receive({
      message_id: ws.sentAs<{ message_id: string }>(0).message_id,
      result: { configuration: "kitchen.yaml", rewritten: false },
    });
    await expect(pending).resolves.toEqual({
      configuration: "kitchen.yaml",
      rewritten: false,
    });
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

  it("firmwareInstall defaults port to OTA and force_local to false", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    api.firmwareInstall("foo.yaml");
    const sent = ws.sentAs<{ args: Record<string, unknown> }>(0);
    expect(sent.args).toEqual({
      configuration: "foo.yaml",
      port: "OTA",
      force_local: false,
    });
  });

  it("firmwareInstall threads force_local through to the backend", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    api.firmwareInstall("foo.yaml", "OTA", true);
    const sent = ws.sentAs<{ args: Record<string, unknown> }>(0);
    expect(sent.args).toEqual({
      configuration: "foo.yaml",
      port: "OTA",
      force_local: true,
    });
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

  it("logs sends devices/logs without no_states by default", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const id = api.logs("foo.yaml", "OTA", { onOutput: () => {} });
    expect(id).toBeTruthy();
    const sent = ws.sentAs<{ command: string; args: Record<string, unknown> }>(0);
    expect(sent.command).toBe("devices/logs");
    expect(sent.args).toEqual({ configuration: "foo.yaml", port: "OTA" });
  });

  it("logs forwards no_states=true when noStates is set", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    api.logs("foo.yaml", "OTA", { onOutput: () => {} }, { noStates: true });
    const sent = ws.sentAs<{ args: Record<string, unknown> }>(0);
    expect(sent.args).toEqual({
      configuration: "foo.yaml",
      port: "OTA",
      no_states: true,
    });
  });

  it("logs omits no_states when noStates is false", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    api.logs("foo.yaml", "OTA", { onOutput: () => {} }, { noStates: false });
    const sent = ws.sentAs<{ args: Record<string, unknown> }>(0);
    expect(sent.args).toEqual({ configuration: "foo.yaml", port: "OTA" });
  });

  it("updatePreferences passes the partial prefs as args", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    api.updatePreferences({ theme: "dark" as never });
    const sent = ws.sentAs<{ command: string; args: Record<string, unknown> }>(0);
    expect(sent.command).toBe("config/set_preferences");
    expect(sent.args).toEqual({ theme: "dark" });
  });

  it("detectChip sends config/detect_chip with the port arg and unwraps the chip info", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const payload = {
      chip_family: "ESP32-C3",
      variant: "esp32c3",
      platform: "esp32",
      board_id: "starter-kit",
    };
    const pending = api.detectChip("/dev/cu.usbserial-10");
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("config/detect_chip");
    expect(sent.args).toEqual({ port: "/dev/cu.usbserial-10" });
    ws.receive({ message_id: sent.message_id, result: payload });
    await expect(pending).resolves.toEqual(payload);
  });

  it("detectChip surfaces a backend error message to the caller", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.detectChip("/dev/cu.usbserial-10");
    const sent = ws.sentAs<{ message_id: string }>(0);
    ws.receive({
      message_id: sent.message_id,
      error_code: "unavailable",
      details: "Could not detect a chip on /dev/cu.usbserial-10",
    });
    await expect(pending).rejects.toThrow(
      /Could not detect a chip on \/dev\/cu\.usbserial-10/,
    );
  });

  it("getRemoteBuildSettings sends remote_build/get_settings and unwraps the result", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const payload = { enabled: true, peers: [] };
    const pending = api.getRemoteBuildSettings();
    const sent = ws.sentAs<{ command: string; message_id: string; args?: unknown }>(0);
    expect(sent.command).toBe("remote_build/get_settings");
    expect(sent.args).toBeUndefined();
    ws.receive({ message_id: sent.message_id, result: payload });
    await expect(pending).resolves.toEqual(payload);
  });

  it("setRemoteBuildSettings sends remote_build/set_settings with the args and returns the result", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.setRemoteBuildSettings({ enabled: true });
    const sent = ws.sentAs<{ command: string; message_id: string; args: Record<string, unknown> }>(0);
    expect(sent.command).toBe("remote_build/set_settings");
    expect(sent.args).toEqual({ enabled: true });
    const result = { enabled: true, peers: [] };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("getOffloaderRemoteBuildSettings sends remote_build/get_offloader_settings without args", async () => {
    // 7b — the bundle entry-point for the offloader Settings UI.
    // First paint reads the master ``remote_builds_enabled``
    // flag and the pairings list off the same round-trip; live
    // updates flow through the OFFLOADER_REMOTE_BUILDS_TOGGLED
    // / OFFLOADER_PAIRING_ENABLED_CHANGED events on subscribe.
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.getOffloaderRemoteBuildSettings();
    const sent = ws.sentAs<{ command: string; message_id: string; args?: unknown }>(0);
    expect(sent.command).toBe("remote_build/get_offloader_settings");
    expect(sent.args).toBeUndefined();
    const result = { remote_builds_enabled: true, pairings: [] };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("setOffloaderRemoteBuildSettings sends remote_build/set_offloader_settings with the master toggle", async () => {
    // The master kill-switch flip path: app-shell calls this
    // when the user clicks the "Auto-route installs to remote
    // build" switch. The backend round-trip carries strict
    // boolean validation (rejects truthy non-booleans); the
    // API helper passes the value through unchanged.
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.setOffloaderRemoteBuildSettings({
      remote_builds_enabled: false,
    });
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("remote_build/set_offloader_settings");
    expect(sent.args).toEqual({ remote_builds_enabled: false });
    const result = { remote_builds_enabled: false, pairings: [] };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("setOffloaderPairingEnabled sends remote_build/set_pairing_enabled keyed on pin_sha256", async () => {
    // The per-row enable flip path. Wire-canonical row id is
    // ``pin_sha256`` (4a-o part 6 re-keyed offloader state
    // from ``(host, port)`` to pin so receiver hostname
    // changes don't break the row identity); the API helper
    // matches.
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.setOffloaderPairingEnabled({
      pin_sha256: "a".repeat(64),
      enabled: false,
    });
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("remote_build/set_pairing_enabled");
    expect(sent.args).toEqual({
      pin_sha256: "a".repeat(64),
      enabled: false,
    });
    // Backend returns the patched ``PairingSummary``; the
    // helper passes it through unchanged so app-shell's
    // ``_patchOffloadPairing`` flow has the canonical row.
    const result = {
      receiver_hostname: "build.local",
      receiver_port: 6055,
      pin_sha256: "a".repeat(64),
      label: "desktop",
      paired_at: 1.0,
      status: "approved",
      connected: true,
      connecting: false,
      last_connect_error: "",
      esphome_version: "2026.5.0",
      enabled: false,
    };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  // No ``listRemoteBuildHosts`` / ``addRemoteBuildManualHost`` /
  // ``removeRemoteBuildManualHost`` tests — the wrappers were
  // deleted in lockstep with the backend rip-out. Discovered
  // hosts ship via ``subscribe_events`` initial-state +
  // ``REMOTE_BUILD_HOST_ADDED`` / ``REMOTE_BUILD_HOST_REMOVED``;
  // manual hosts went away as a UI surface (the pair dialog
  // accepts a typed hostname / port directly). Same shape as
  // the ``listRemoteBuildPeers`` deletion in #248.

  it("approveRemoteBuildPeer sends remote_build/approve_peer with dashboard_id", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.approveRemoteBuildPeer({ dashboard_id: "green" });
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("remote_build/approve_peer");
    expect(sent.args).toEqual({ dashboard_id: "green" });
    const result = { enabled: true, peers: [] };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("removeRemoteBuildPeer sends remote_build/remove_peer with dashboard_id", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.removeRemoteBuildPeer({ dashboard_id: "green" });
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("remote_build/remove_peer");
    expect(sent.args).toEqual({ dashboard_id: "green" });
    const result = { enabled: true, peers: [] };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("setRemoteBuildPairingWindow sends remote_build/set_pairing_window with open flag", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.setRemoteBuildPairingWindow({ open: true });
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("remote_build/set_pairing_window");
    expect(sent.args).toEqual({ open: true });
    const result = { open: true, expires_in_seconds: 300 };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("previewRemoteBuildPair sends remote_build/preview_pair and unwraps the pin", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.previewRemoteBuildPair({
      hostname: "build.local",
      port: 6055,
    });
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("remote_build/preview_pair");
    expect(sent.args).toEqual({ hostname: "build.local", port: 6055 });
    const result = { pin_sha256: "a".repeat(64) };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("requestRemoteBuildPair sends host + pin + both labels (TOCTOU + dual label)", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const args = {
      hostname: "build.local",
      port: 6055,
      pin_sha256: "a".repeat(64),
      receiver_label: "build server",
      offloader_label: "green",
    };
    const pending = api.requestRemoteBuildPair(args);
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("remote_build/request_pair");
    // Pin the wire shape: both labels go through; the receiver
    // sees ``offloader_label`` and the local ``StoredPairing``
    // gets ``receiver_label``. Conflating them would let a
    // receiver-side rename retro-rewrite the offloader's row.
    expect(sent.args).toEqual(args);
    const result = {
      receiver_hostname: "build.local",
      receiver_port: 6055,
      pin_sha256: args.pin_sha256,
      label: "build server",
      paired_at: 1715212800,
      status: "pending",
    };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("unpairRemoteBuild sends remote_build/unpair with pin_sha256", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.unpairRemoteBuild({
      pin_sha256: "a".repeat(64),
    });
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("remote_build/unpair");
    expect(sent.args).toEqual({ pin_sha256: "a".repeat(64) });
    const result = { removed: true };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("editRemoteBuildPairingEndpoint sends remote_build/edit_pairing_endpoint with pin + new coords", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.editRemoteBuildPairingEndpoint({
      pin_sha256: "a".repeat(64),
      hostname: "moved.example.com",
      port: 6058,
    });
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("remote_build/edit_pairing_endpoint");
    expect(sent.args).toEqual({
      pin_sha256: "a".repeat(64),
      hostname: "moved.example.com",
      port: 6058,
    });
    // Backend mutates StoredPairing in place + returns the
    // updated PairingSummary projection. Frontend uses it
    // primarily as a "the rebind succeeded" signal — the
    // pairings-context subscriber on app-shell upserts the
    // row from the OFFLOADER_PAIR_ENDPOINT_REBOUND event.
    const result = {
      receiver_hostname: "moved.example.com",
      receiver_port: 6058,
      pin_sha256: "a".repeat(64),
      label: "desktop",
      paired_at: 1_700_000_000.0,
      status: "approved",
      connected: false,
      connecting: true,
      last_connect_error: "",
    };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("submitRemoteBuildJob sends remote_build/submit_job with pin + configuration + target", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.submitRemoteBuildJob({
      pin_sha256: "a".repeat(64),
      configuration: "kitchen.yaml",
      target: JobType.COMPILE,
    });
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("remote_build/submit_job");
    expect(sent.args).toEqual({
      pin_sha256: "a".repeat(64),
      configuration: "kitchen.yaml",
      target: JobType.COMPILE,
    });
    const result = { job_id: "abc123", accepted: true };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("submitRemoteBuildJob surfaces a rejection with reason", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.submitRemoteBuildJob({
      pin_sha256: "a".repeat(64),
      configuration: "kitchen.yaml",
      target: JobType.UPLOAD,
    });
    const sent = ws.sentAs<{ message_id: string }>(0);
    const result = { job_id: "abc123", accepted: false, reason: "queue_full" };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("cancelRemoteBuildJob sends remote_build/cancel_job with pin + job_id", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.cancelRemoteBuildJob({
      pin_sha256: "a".repeat(64),
      job_id: "abc123",
    });
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("remote_build/cancel_job");
    expect(sent.args).toEqual({
      pin_sha256: "a".repeat(64),
      job_id: "abc123",
    });
    const result = { sent: true };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("cancelRemoteBuildJob surfaces sent=false on a same-tick wire failure", async () => {
    // ``sent: false`` is the documented signal for a Noise-encrypt
    // / WS-send failure on the offloader side — the cancel never
    // reached the wire. The frontend treats it the same as a
    // typed error toast (the receiver's JOB_CANCELLED-driven
    // status flip won't fire), but the API client wrapper
    // itself just returns the literal payload; mapping happens
    // in the dialog.
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const pending = api.cancelRemoteBuildJob({
      pin_sha256: "a".repeat(64),
      job_id: "abc123",
    });
    const sent = ws.sentAs<{ message_id: string }>(0);
    const result = { sent: false };
    ws.receive({ message_id: sent.message_id, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("getRemoteBuildIdentity sends remote_build/get_identity and unwraps the result", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const payload = {
      dashboard_id: "abc123",
      pin_sha256: "a".repeat(64),
      server_version: "1.2.3",
      esphome_version: "2026.5.0",
      listener_bound: true,
    };
    const pending = api.getRemoteBuildIdentity();
    const sent = ws.sentAs<{ command: string; message_id: string; args?: unknown }>(0);
    expect(sent.command).toBe("remote_build/get_identity");
    expect(sent.args).toBeUndefined();
    ws.receive({ message_id: sent.message_id, result: payload });
    await expect(pending).resolves.toEqual(payload);
  });

  it("rotateRemoteBuildIdentity sends remote_build/rotate_identity and unwraps the result", async () => {
    const api = new ESPHomeAPI();
    const ws = await connect(api);
    const payload = {
      dashboard_id: "abc123",
      pin_sha256: "b".repeat(64),
      server_version: "1.2.3",
      esphome_version: "2026.5.0",
      listener_bound: true,
    };
    const pending = api.rotateRemoteBuildIdentity();
    const sent = ws.sentAs<{ command: string; message_id: string; args?: unknown }>(0);
    expect(sent.command).toBe("remote_build/rotate_identity");
    expect(sent.args).toBeUndefined();
    ws.receive({ message_id: sent.message_id, result: payload });
    await expect(pending).resolves.toEqual(payload);
  });
});

describe("ESPHomeAPI — auth", () => {
  beforeEach(() => {
    installMockWebSocket();
    stubLocalStorage();
  });
  afterEach(() => {
    uninstallMockWebSocket();
    vi.unstubAllGlobals();
  });

  it("ready resolves immediately when requires_auth is false", async () => {
    const api = new ESPHomeAPI();
    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfo);
    await pending;
    // No login needed — the trusted-ingress / no-password case.
    await expect(api.ready).resolves.toBeUndefined();
  });

  it("fires onAuthRequired when requires_auth is true and no token is stored", async () => {
    const api = new ESPHomeAPI();
    const onAuthRequired = vi.fn();
    api.onAuthRequired = onAuthRequired;
    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfoAuthRequired);
    await pending;
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });

  it("auto-replays a stored token when requires_auth is true", async () => {
    stubLocalStorage({
      "esphome.auth-token": JSON.stringify({
        token: "stored-tok",
        expires_at: 1_700_000_000,
      }),
    });
    const api = new ESPHomeAPI();
    const onAuthRequired = vi.fn();
    api.onAuthRequired = onAuthRequired;

    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfoAuthRequired);
    await pending;

    // The auto-replay sends auth/login {token}.
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("auth/login");
    expect(sent.args).toEqual({ token: "stored-tok" });

    // Server accepts; ready resolves and onAuthRequired never fires.
    ws.receive({
      message_id: sent.message_id,
      result: { token: "fresh-tok", expires_at: 1_800_000_000 },
    });
    await expect(api.ready).resolves.toBeUndefined();
    expect(onAuthRequired).not.toHaveBeenCalled();

    // Fresh token persisted for the next reconnect.
    expect(localStorage.getItem("esphome.auth-token")).toBe(
      JSON.stringify({ token: "fresh-tok", expires_at: 1_800_000_000 }),
    );
  });

  it("clears the stored token + fires onAuthRequired when the replay is rejected", async () => {
    stubLocalStorage({
      "esphome.auth-token": JSON.stringify({
        token: "stale-tok",
        expires_at: 1_700_000_000,
      }),
    });
    const api = new ESPHomeAPI();
    const onAuthRequired = vi.fn();
    api.onAuthRequired = onAuthRequired;

    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfoAuthRequired);
    await pending;

    const sent = ws.sentAs<{ message_id: string }>(0);
    ws.receive({
      message_id: sent.message_id,
      error_code: "not_authenticated",
      details: "Invalid or expired token",
    });

    // The stored token is wiped — no point trying it again.
    await vi.waitFor(() => {
      expect(onAuthRequired).toHaveBeenCalledTimes(1);
    });
    expect(localStorage.getItem("esphome.auth-token")).toBeNull();
  });

  it("login(credentials) sends username/password and persists the token", async () => {
    const api = new ESPHomeAPI();
    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfoAuthRequired);
    await pending;

    const loginPromise = api.login({ username: "admin", password: "hunter2" });
    const sent = ws.sentAs<{
      command: string;
      message_id: string;
      args: Record<string, unknown>;
    }>(0);
    expect(sent.command).toBe("auth/login");
    expect(sent.args).toEqual({ username: "admin", password: "hunter2" });

    ws.receive({
      message_id: sent.message_id,
      result: { token: "new-tok", expires_at: 1_900_000_000 },
    });

    await expect(loginPromise).resolves.toEqual({
      token: "new-tok",
      expires_at: 1_900_000_000,
    });
    await expect(api.ready).resolves.toBeUndefined();
    expect(localStorage.getItem("esphome.auth-token")).toBe(
      JSON.stringify({ token: "new-tok", expires_at: 1_900_000_000 }),
    );
  });

  it("login surfaces APIError with not_authenticated for bad credentials", async () => {
    const api = new ESPHomeAPI();
    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfoAuthRequired);
    await pending;

    const loginPromise = api.login({ username: "admin", password: "wrong" });
    const sent = ws.sentAs<{ message_id: string }>(0);
    ws.receive({
      message_id: sent.message_id,
      error_code: "not_authenticated",
      details: "Invalid credentials",
    });

    await expect(loginPromise).rejects.toBeInstanceOf(APIError);
    try {
      await loginPromise;
    } catch (err) {
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).errorCode).toBe("not_authenticated");
      expect((err as APIError).details).toBe("Invalid credentials");
    }
  });

  it("login surfaces APIError with rate_limited including the details string", async () => {
    const api = new ESPHomeAPI();
    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfoAuthRequired);
    await pending;

    const loginPromise = api.login({ username: "admin", password: "wrong" });
    const sent = ws.sentAs<{ message_id: string }>(0);
    ws.receive({
      message_id: sent.message_id,
      error_code: "rate_limited",
      details: "Too many failed attempts; try again in 42s",
    });

    try {
      await loginPromise;
      throw new Error("should have rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).errorCode).toBe("rate_limited");
      expect((err as APIError).details).toContain("42s");
    }
  });

  it("logout clears the stored token on success", async () => {
    stubLocalStorage({
      "esphome.auth-token": JSON.stringify({
        token: "tok",
        expires_at: 1_700_000_000,
      }),
    });
    const api = new ESPHomeAPI();
    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfoAuthRequired);
    await pending;

    // Drain the auto-replay so the next sentAs call sees logout.
    const replay = ws.sentAs<{ message_id: string }>(0);
    ws.receive({
      message_id: replay.message_id,
      result: { token: "tok", expires_at: 1_800_000_000 },
    });
    await api.ready;

    const logoutPromise = api.logout();
    const sent = ws.sentAs<{ command: string; message_id: string }>(1);
    expect(sent.command).toBe("auth/logout");
    ws.receive({ message_id: sent.message_id, result: { logged_out: true } });
    await logoutPromise;

    expect(localStorage.getItem("esphome.auth-token")).toBeNull();
  });

  it("falls back to the in-memory token when localStorage writes silently fail", async () => {
    // Private-mode browsers / sandboxed iframes throw on every
    // localStorage access. ``login()`` still keeps a copy in
    // ``_authToken`` so reconnects within the same tab can replay it
    // without dropping the user back to the form.
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      clear: () => {},
    });

    const api = new ESPHomeAPI();
    const onAuthRequired = vi.fn();
    api.onAuthRequired = onAuthRequired;

    // First connect: server requires auth, no stored token → form.
    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfoAuthRequired);
    await pending;
    expect(onAuthRequired).toHaveBeenCalledTimes(1);

    // User signs in. setStoredToken throws but is swallowed; the API
    // client caches the token in memory.
    const loginPromise = api.login({ username: "admin", password: "hunter2" });
    const sent = ws.sentAs<{ message_id: string }>(0);
    ws.receive({
      message_id: sent.message_id,
      result: { token: "in-mem-tok", expires_at: 1_900_000_000 },
    });
    await loginPromise;

    // Socket drops, reconnect. The stored-token lookup misses (private
    // mode) but the in-memory cache carries the session forward.
    ws.close();

    const reconnect = api.connect();
    const ws2 = MockWebSocket.latest();
    ws2.open();
    ws2.receive(serverInfoAuthRequired);
    await reconnect;

    const replay = ws2.sentAs<{
      command: string;
      args: Record<string, unknown>;
      message_id: string;
    }>(0);
    expect(replay.command).toBe("auth/login");
    expect(replay.args).toEqual({ token: "in-mem-tok" });

    // No second prompt — onAuthRequired was only called for the first
    // (pre-login) connect.
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });

  it("ready parks until the next successful connect+auth after a disconnect", async () => {
    // Without this contract, any caller that awaits ``api.ready``
    // during the reconnect-backoff window resumes against the closed
    // socket and immediately hits "WebSocket not connected".
    const api = new ESPHomeAPI();
    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfo);
    await pending;
    await api.ready; // resolves immediately — no auth required.

    // Drop the socket. ``ready`` should now be a fresh pending
    // promise — anyone awaiting it parks until the reconnect lands.
    ws.close();

    let resolved = false;
    void api.ready.then(() => {
      resolved = true;
    });
    // Yield twice so any spurious resolution would have flushed.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Reconnect; ``ready`` resolves only after the new serverinfo.
    const second = api.connect();
    const ws2 = MockWebSocket.latest();
    ws2.open();
    ws2.receive(serverInfo);
    await second;
    await api.ready;
    expect(resolved).toBe(true);
  });

  it("logout clears the stored token even when the request fails", async () => {
    // The intent of ``logout`` is "sign me out of this browser" — a
    // backend hiccup (network blip, internal_error) shouldn't strand
    // the token in localStorage where the next reconnect would
    // happily replay it. The ``finally`` block in ``logout()`` is the
    // contract we're pinning here.
    stubLocalStorage({
      "esphome.auth-token": JSON.stringify({
        token: "tok",
        expires_at: 1_700_000_000,
      }),
    });
    const api = new ESPHomeAPI();
    const pending = api.connect();
    const ws = MockWebSocket.latest();
    ws.open();
    ws.receive(serverInfoAuthRequired);
    await pending;

    const replay = ws.sentAs<{ message_id: string }>(0);
    ws.receive({
      message_id: replay.message_id,
      result: { token: "tok", expires_at: 1_800_000_000 },
    });
    await api.ready;

    const logoutPromise = api.logout();
    const sent = ws.sentAs<{ command: string; message_id: string }>(1);
    expect(sent.command).toBe("auth/logout");
    ws.receive({
      message_id: sent.message_id,
      error_code: "internal_error",
      details: "boom",
    });

    await expect(logoutPromise).rejects.toBeInstanceOf(APIError);
    // Local state cleared regardless of the rejection.
    expect(localStorage.getItem("esphome.auth-token")).toBeNull();
  });
});
