/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { call, makeLogsDialog, session } from "./_logs-dialog-env.js";

import type { ESPHomeLogsDialog } from "./_logs-dialog-env.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
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
    handlers = [];
    let n = 0;
    logs = vi.fn((_c: string, _p: string, cb: StreamCallbacks) => {
      handlers.push(cb);
      return `stream-${++n}`;
    });
    el = makeLogsDialog({
      logs,
      stopStream: vi.fn(() => Promise.resolve()),
      ready: Promise.resolve(),
    });
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

  it("passes the gated connection-lost flag to the terminal for an ota session", async () => {
    el.open("OTA");
    (el as any)._connectionLost = true;
    await el.updateComplete;
    const terminal = el.shadowRoot!.querySelector("esphome-process-terminal") as any;
    expect(terminal.connectionLost).toBe(true);
    expect(terminal.connectionLostMessage).toBe("dashboard.logs_connection_lost");

    (el as any)._connectionLost = false;
    await el.updateComplete;
    expect(terminal.connectionLost).toBe(false);
  });

  it("shows no banner for a Web Serial session when the WS drops", async () => {
    // The serial bytes come off USB; the dashboard connection is
    // irrelevant to that stream.
    el.openPassive({ onReconnect: () => Promise.resolve() });
    (el as any)._connectionLost = true;
    await el.updateComplete;
    const terminal = el.shadowRoot!.querySelector("esphome-process-terminal") as any;
    expect(terminal.connectionLost).toBe(false);
  });
});
