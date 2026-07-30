/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeLogsDialog } from "../../src/components/logs-dialog.js";
import type { LogsSession } from "../../src/components/logs-session.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = (el: ESPHomeLogsDialog): LogsSession => (el as any)._session;
const call = (el: ESPHomeLogsDialog, method: string) => (el as any)[method]();

type StreamCallbacks = {
  onOutput: (l: string) => void;
  onError: (e: string) => void;
  onConnectionLost: () => void;
};

describe("logs-dialog OTA connection loss", () => {
  let el: ESPHomeLogsDialog;
  let logs: ReturnType<typeof vi.fn>;
  let handlers: StreamCallbacks[];

  beforeEach(() => {
    document.body.innerHTML = "";
    el = new ESPHomeLogsDialog();
    handlers = [];
    let n = 0;
    logs = vi.fn((_c: string, _p: string, cb: StreamCallbacks) => {
      handlers.push(cb);
      return `stream-${++n}`;
    });
    (el as any)._api = {
      logs,
      stopStream: vi.fn(() => Promise.resolve()),
      ready: Promise.resolve(),
    };
    document.body.appendChild(el);
  });

  it("marks the session interrupted on connection loss without appending a line", () => {
    el.open("OTA");
    handlers[0].onConnectionLost();
    expect(session(el)).toMatchObject({
      kind: "ota",
      streamId: null,
      interrupted: true,
    });
    expect((el as any)._log.lines).toEqual([]);
  });

  it("appends a real backend error to the log pane", () => {
    el.open("OTA");
    handlers[0].onError("configuration not found");
    expect(session(el)).toMatchObject({ kind: "ota", streamId: null });
    expect(session(el)).not.toHaveProperty("interrupted", true);
    expect((el as any)._log.lines).toEqual(["configuration not found"]);
  });

  it("ignores a stale stream's late connection-loss signal", () => {
    el.open("OTA"); // stream-1
    call(el, "_onStop");
    call(el, "_onStart"); // stream-2
    handlers[0].onConnectionLost(); // stale
    expect(session(el)).toMatchObject({ kind: "ota", streamId: "stream-2" });
  });

  it("stays stopped and interrupted when the send is refused outright", () => {
    // sendStreamCommand fires onConnectionLost synchronously and
    // returns "" when the socket is already known dead.
    logs.mockImplementation((_c: string, _p: string, cb: StreamCallbacks) => {
      cb.onConnectionLost();
      return "";
    });
    el.open("OTA");
    expect(session(el)).toMatchObject({
      kind: "ota",
      streamId: null,
      interrupted: true,
    });
  });

  it("resumes the stream on the reconnect edge with a reconnected line", async () => {
    el.open("OTA");
    await el.updateComplete;
    (el as any)._apiConnected = false;
    await el.updateComplete;
    handlers[0].onConnectionLost();

    (el as any)._apiConnected = true;
    await el.updateComplete;
    await vi.waitFor(() => expect(logs).toHaveBeenCalledTimes(2));
    expect((el as any)._log.lines).toEqual(["dashboard.logs_reconnected"]);
    expect(session(el)).toMatchObject({ kind: "ota", streamId: "stream-2" });
  });

  it("does not resume a stream the user stopped before the drop", async () => {
    el.open("OTA");
    await el.updateComplete;
    call(el, "_onStop");
    (el as any)._apiConnected = false;
    await el.updateComplete;

    (el as any)._apiConnected = true;
    await el.updateComplete;
    await (el as any)._api.ready;
    expect(logs).toHaveBeenCalledTimes(1);
    expect(session(el)).toMatchObject({ kind: "ota", streamId: null });
  });

  it("shows the connection-lost banner on the terminal while disconnected", async () => {
    el.open("OTA");
    (el as any)._apiConnected = false;
    await el.updateComplete;
    const terminal = el.shadowRoot!.querySelector("esphome-process-terminal") as any;
    expect(terminal.state).toBe("error");
    expect(terminal.statusMessage).toBe("dashboard.logs_connection_lost");

    (el as any)._apiConnected = true;
    await el.updateComplete;
    expect(terminal.state).toBeNull();
    expect(terminal.statusMessage).toBe("");
  });
});
