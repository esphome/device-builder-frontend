import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ESPHomeAPI } from "../../src/api/esphome-api.js";
import {
  installMockWebSocket,
  MockWebSocket,
  uninstallMockWebSocket,
} from "./mock-websocket.js";

const serverInfo = {
  server_version: "1.0.0",
  esphome_version: "2025.1.0",
  port: 6052,
  ha_addon: false,
  requires_auth: false,
};

const liveApis: ESPHomeAPI[] = [];

async function connect(): Promise<{ api: ESPHomeAPI; ws: MockWebSocket }> {
  const api = new ESPHomeAPI();
  liveApis.push(api);
  const pending = api.connect();
  const ws = MockWebSocket.latest();
  ws.open();
  ws.receive(serverInfo);
  await pending;
  return { api, ws };
}

interface Sent {
  command: string;
  message_id: string;
  args?: Record<string, unknown>;
}

describe("ESPHomeAPI — files commands", () => {
  beforeEach(() => installMockWebSocket());
  afterEach(() => {
    for (const api of liveApis) api.disconnect();
    liveApis.length = 0;
    uninstallMockWebSocket();
  });

  it.each([
    ["listPackages", [], "files/list_packages", undefined, [{ path: "common/a.yaml" }]],
    [
      "createFile",
      ["common/a.yaml", "a: 1\n"],
      "files/create",
      { path: "common/a.yaml", content: "a: 1\n" },
      { path: "common/a.yaml" },
    ],
    [
      "deleteFile",
      ["common/a.yaml"],
      "files/delete",
      { path: "common/a.yaml" },
      undefined,
    ],
    [
      "renameFile",
      ["common/a.yaml", "shared/a.yaml"],
      "files/rename",
      { path: "common/a.yaml", new_path: "shared/a.yaml" },
      { path: "shared/a.yaml", rewritten: ["k.yaml"], unresolved: [] },
    ],
    [
      "getFileUsage",
      ["common/a.yaml"],
      "files/usage",
      { path: "common/a.yaml" },
      { used_by: ["k.yaml"], unknown: [] },
    ],
    [
      "getDeviceDependencies",
      ["k.yaml"],
      "files/dependencies",
      { configuration: "k.yaml" },
      { files: ["common/a.yaml"], complete: true },
    ],
  ] as const)("%s sends %s", async (method, args, command, sentArgs, result) => {
    const { api, ws } = await connect();
    const call = (api[method] as (...a: unknown[]) => Promise<unknown>).bind(api);

    const pending = call(...args);
    const sent = ws.sentAs<Sent>(0);

    expect(sent.command).toBe(command);
    if (sentArgs === undefined) expect(sent.args ?? {}).toEqual({});
    else expect(sent.args).toEqual(sentArgs);
    ws.receive({ message_id: sent.message_id, result: result ?? null });
    await expect(pending).resolves.toEqual(result);
  });

  it("updateConfig forwards ``expected``, even an empty one", async () => {
    const { api, ws } = await connect();

    const pending = api.updateConfig("common/a.yaml", "b: 2\n", { expected: "" });
    const sent = ws.sentAs<Sent>(0);

    expect(sent.args).toEqual({
      configuration: "common/a.yaml",
      content: "b: 2\n",
      expected: "",
    });
    ws.receive({ message_id: sent.message_id, result: null });
    await expect(pending).resolves.toBeUndefined();
  });
});
