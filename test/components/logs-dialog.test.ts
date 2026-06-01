/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner-js", () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

import { ESPHomeLogsDialog } from "../../src/components/logs-dialog.js";
import {
  hasSerialPort,
  isStreaming,
  type LogsSession,
} from "../../src/components/logs-session.js";

// Read the dialog's private session/getters without sprinkling casts inline.
/* eslint-disable @typescript-eslint/no-explicit-any */
const session = (el: ESPHomeLogsDialog): LogsSession => (el as any)._session;
const streaming = (el: ESPHomeLogsDialog): boolean => isStreaming(session(el));
const paused = (el: ESPHomeLogsDialog): boolean => (el as any)._serialPaused;
const call = (el: ESPHomeLogsDialog, method: string) => (el as any)[method]();

interface DeferredStop {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): DeferredStop {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("logs-dialog states-toggle restart", () => {
  let el: ESPHomeLogsDialog;
  let logs: ReturnType<typeof vi.fn>;
  let stop: DeferredStop;
  let stopStream: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    el = new ESPHomeLogsDialog();
    stop = deferred();
    let n = 0;
    logs = vi.fn(() => `stream-${++n}`);
    stopStream = vi.fn(() => stop.promise);
    (el as any)._api = { logs, stopStream };
  });

  it("does not respawn a stream when the dialog is closed mid-restart", async () => {
    el.open("OTA");
    expect(logs).toHaveBeenCalledTimes(1); // initial subscription
    expect((el as any)._open).toBe(true);

    // Flip the states toggle: awaits the stopStream cancel before respawning.
    const restart = call(el, "_toggleShowStates");

    // The user closes the dialog while the cancel round-trip is outstanding.
    call(el, "_onDialogHide");
    expect((el as any)._open).toBe(false);

    stop.resolve(); // the cancel lands; the toggle continuation runs
    await restart;

    // No fresh subscription on the closed dialog; session fully torn down.
    expect(logs).toHaveBeenCalledTimes(1);
    expect(session(el).kind).toBe("idle");
    expect(streaming(el)).toBe(false);
  });

  it("still respawns the stream when the dialog stays open", async () => {
    el.open("OTA");
    expect(logs).toHaveBeenCalledTimes(1);

    const restart = call(el, "_toggleShowStates");
    stop.resolve(); // cancel lands while the dialog is still open
    await restart;

    // The toggle respawns with the new --no-states flag.
    expect(logs).toHaveBeenCalledTimes(2);
    expect(stopStream).toHaveBeenCalledTimes(1);
    expect(session(el)).toMatchObject({ kind: "ota", streamId: "stream-2" });
  });
});

describe("logs-dialog OTA stale-callback guard", () => {
  it("ignores onResult from a torn-down stream so it can't stop its replacement", () => {
    const el = new ESPHomeLogsDialog();
    const handlers: { onResult: () => void }[] = [];
    let n = 0;
    (el as any)._api = {
      logs: (_c: string, _p: string, cb: { onResult: () => void }) => {
        handlers.push(cb);
        return `stream-${++n}`;
      },
      stopStream: () => Promise.resolve(),
    };

    el.open("OTA"); // stream-1
    call(el, "_onStop"); // stop stream-1
    call(el, "_onStart"); // stream-2
    expect(session(el)).toMatchObject({ kind: "ota", streamId: "stream-2" });

    handlers[0].onResult(); // stale callback from stream-1
    expect(session(el)).toMatchObject({ kind: "ota", streamId: "stream-2" });

    handlers[1].onResult(); // the current stream's own callback does stop it
    expect(session(el)).toMatchObject({ kind: "ota", streamId: null });
  });
});

describe("logs-dialog header source chip", () => {
  function mount(): ESPHomeLogsDialog {
    const el = new ESPHomeLogsDialog();
    (el as any)._api = { logs: () => "s1", stopStream: () => Promise.resolve() };
    document.body.appendChild(el);
    return el;
  }

  function chipText(el: ESPHomeLogsDialog): string {
    return el.shadowRoot!.querySelector(".source-chip")?.textContent?.trim() ?? "";
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows OTA for an OTA session", async () => {
    const el = mount();
    el.open("OTA");
    await el.updateComplete;
    expect(chipText(el)).toBe("OTA");
  });

  it("shows the serial path for a server-serial session", async () => {
    const el = mount();
    el.open("/dev/cu.usbserial-110");
    await el.updateComplete;
    expect(chipText(el)).toBe("/dev/cu.usbserial-110");
  });

  it("shows the Web Serial label for a passive (Web Serial) session", async () => {
    const el = mount();
    el.openPassive({ onReconnect: () => Promise.resolve() });
    await el.updateComplete;
    // Identity _localize in tests returns the key verbatim.
    expect(chipText(el)).toBe("dashboard.logs_source_web_serial");
  });
});

describe("logs-dialog States toggle gate (#539)", () => {
  function mount(): ESPHomeLogsDialog {
    const el = new ESPHomeLogsDialog();
    (el as any)._api = { logs: () => "s1", stopStream: () => Promise.resolve() };
    document.body.appendChild(el);
    return el;
  }

  // The States toggle is the only toolbar control with aria-pressed.
  const hasStatesToggle = (el: ESPHomeLogsDialog): boolean =>
    el.shadowRoot!.querySelector("[aria-pressed]") !== null;

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the States toggle for an OTA (network) session", async () => {
    const el = mount();
    el.open("OTA");
    await el.updateComplete;
    expect(hasStatesToggle(el)).toBe(true);
  });

  it("hides the States toggle for a server-serial session", async () => {
    const el = mount();
    el.open("/dev/cu.usbserial-110");
    await el.updateComplete;
    expect(hasStatesToggle(el)).toBe(false);
  });

  it("hides the States toggle for a passive (Web Serial) session", async () => {
    const el = mount();
    el.openPassive({ onReconnect: () => Promise.resolve() });
    await el.updateComplete;
    expect(hasStatesToggle(el)).toBe(false);
  });
});

describe("logs-dialog passive Web Serial session (#526)", () => {
  let el: ESPHomeLogsDialog;
  let logs: ReturnType<typeof vi.fn>;
  let port: { close: ReturnType<typeof vi.fn>; setSignals: ReturnType<typeof vi.fn> };
  let cancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toastError.mockClear();
    el = new ESPHomeLogsDialog();
    logs = vi.fn(() => "stream-1");
    (el as any)._api = { logs, stopStream: vi.fn(() => Promise.resolve()) };
    port = {
      close: vi.fn(() => Promise.resolve()),
      setSignals: vi.fn(() => Promise.resolve()),
    };
    cancel = vi.fn();
  });

  // Drive a live passive session the way attachSerialLogStream does.
  function startPassive() {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    el.setSerialStream(port as any, cancel as unknown as () => void);
  }

  it("Stop pauses display but keeps the reader + port open (no reopen on resume)", () => {
    startPassive();
    call(el, "_onStop");
    // Paused for display, but the reader was NOT cancelled and the port NOT
    // closed — so resuming needs no reopen (which would reboot the device).
    expect(session(el)).toMatchObject({ kind: "serial", paused: true });
    expect(streaming(el)).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(port.close).not.toHaveBeenCalled();
  });

  it("Start resumes display and never spawns a backend OTA stream", () => {
    startPassive();
    call(el, "_onStop");
    call(el, "_onStart");
    expect(session(el)).toMatchObject({ kind: "serial", paused: false });
    expect(streaming(el)).toBe(true);
    expect(logs).not.toHaveBeenCalled(); // never the OTA backend stream
    expect(cancel).not.toHaveBeenCalled();
    expect(port.close).not.toHaveBeenCalled();
  });

  it("never spawns a backend stream from a serial session", () => {
    startPassive();
    // _startOtaStream only fires from a stopped OTA session.
    call(el, "_startOtaStream");
    expect(logs).not.toHaveBeenCalled();
  });

  it("dialog close tears down the serial session (closes port, returns to idle)", () => {
    startPassive();
    call(el, "_onDialogHide");
    // The cancel (from streamSerialToDialog) stops the reader and closes the
    // port; the session drops back to idle so a reopen starts clean.
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(session(el).kind).toBe("idle");
  });

  it("Reset Device pulses RTS then releases it (auto-reset), without closing the port", async () => {
    startPassive();
    await (el as any)._onResetDevice();
    expect(port.setSignals).toHaveBeenNthCalledWith(1, {
      dataTerminalReady: false,
      requestToSend: true,
    });
    expect(port.setSignals).toHaveBeenNthCalledWith(2, {
      dataTerminalReady: false,
      requestToSend: false,
    });
    expect(port.close).not.toHaveBeenCalled();
  });

  it("Reset Device resumes a paused log so the boot output shows", async () => {
    startPassive();
    call(el, "_onStop"); // user had Stopped (paused) the log
    await (el as any)._onResetDevice();
    expect(session(el)).toMatchObject({ kind: "serial", paused: false });
    expect(streaming(el)).toBe(true);
    expect(port.setSignals).toHaveBeenCalled();
  });

  it("Reset Device toasts when the reset pulse fails (cable pulled)", async () => {
    port.setSignals = vi.fn(() => Promise.reject(new Error("device gone")));
    startPassive();
    await (el as any)._onResetDevice();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("non-passive (OTA) Start still spawns a backend stream", () => {
    el.open("OTA");
    expect(logs).toHaveBeenCalledTimes(1); // initial OTA subscription
    call(el, "_onStop");
    call(el, "_onStart");
    expect(logs).toHaveBeenCalledTimes(2); // OTA path intact
  });

  it("Start reconnects (not OTA) when the reader is gone after a reopen failure", () => {
    const reconnect = vi.fn(() => Promise.resolve());
    el.openPassive({ onReconnect: reconnect });
    // A reopen failure tears the reader down and drops to `dead`; Start re-runs
    // the reconnect hook (#636).
    el.setSerialOpenFailed("reopen failed");
    expect(session(el).kind).toBe("dead");

    call(el, "_onStart");
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(logs).not.toHaveBeenCalled(); // reconnect, never an OTA stream
  });

  it("Stop then Start during an in-flight reconnect does not fire a second reconnect", () => {
    // A reconnect that never resolves (still retrying the port reopen).
    const reconnect = vi.fn(() => new Promise<void>(() => {}));
    el.openPassive({ onReconnect: reconnect });
    el.setSerialOpenFailed("reopen failed"); // -> dead
    call(el, "_onStart"); // dead -> fire reconnect #1 -> reconnecting
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(session(el).kind).toBe("reconnecting");

    // Stop, then Start again while the first reconnect is still in flight.
    call(el, "_onStop"); // reconnecting -> paused
    expect(streaming(el)).toBe(false);
    call(el, "_onStart"); // must only un-pause, NOT start a second reconnect
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(session(el)).toMatchObject({ kind: "reconnecting", paused: false });
  });

  it("honors a Stop pressed during an in-flight reconnect when the attach lands", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    call(el, "_onStop"); // pause while the attach is still in flight
    expect(paused(el)).toBe(true);
    // The reconnect resolves and re-attaches; it must land paused, not re-show.
    el.setSerialStream(port as any, cancel as unknown as () => void);
    expect(session(el)).toMatchObject({ kind: "serial", paused: true });
  });

  it("tears down a late attach after the dialog closed (no port leak)", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    call(el, "_onDialogHide"); // closed while an attach was in flight
    const lateCancel = vi.fn();
    el.setSerialStream(port as any, lateCancel as unknown as () => void);
    expect(lateCancel).toHaveBeenCalledTimes(1); // torn down, not registered
    expect(session(el).kind).toBe("idle");
  });

  it("tears down a late passive attach after switching to an OTA session", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    el.open("OTA"); // switched to non-passive before the attach landed
    const lateCancel = vi.fn();
    el.setSerialStream(port as any, lateCancel as unknown as () => void);
    expect(lateCancel).toHaveBeenCalledTimes(1);
    expect(session(el).kind).toBe("ota");
  });

  it("ignores a late reopen failure after switching to an OTA session", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    el.open("OTA"); // dialog reused for an OTA session before the failure landed
    expect(session(el).kind).toBe("ota");
    // A stale reopen failure must not tear down the OTA stream or flip to dead.
    el.setSerialOpenFailed("reopen failed");
    expect(session(el).kind).toBe("ota");
  });

  it("ignores a late reopen failure after the dialog closed", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    call(el, "_onDialogHide");
    el.setSerialOpenFailed("reopen failed");
    expect(session(el).kind).toBe("idle");
  });

  it("tracks port presence so Reset Device can disable itself", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    expect(hasSerialPort(session(el))).toBe(false); // settle window: no port yet
    el.setSerialStream(port as any, cancel as unknown as () => void);
    expect(hasSerialPort(session(el))).toBe(true);
    el.setSerialOpenFailed("gone");
    expect(hasSerialPort(session(el))).toBe(false);
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
