/**
 * @vitest-environment happy-dom
 *
 * The states-toggle restart awaits stopStream before respawning; a close
 * during that await must not spawn a stream onto the closed dialog.
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._api = { logs, stopStream };
  });

  it("does not respawn a stream when the dialog is closed mid-restart", async () => {
    el.open("OTA");
    expect(logs).toHaveBeenCalledTimes(1); // initial subscription
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._open).toBe(true);

    // Flip the states toggle: awaits the stopStream cancel before respawning.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const restart = (el as any)._toggleShowStates();

    // The user closes the dialog while the cancel round-trip is outstanding.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onDialogHide();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._open).toBe(false);

    stop.resolve(); // the cancel lands; the toggle continuation runs
    await restart;

    // No fresh subscription on the closed dialog, and no orphan stream id.
    expect(logs).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._streamId).toBe("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._streaming).toBe(false);
  });

  it("still respawns the stream when the dialog stays open", async () => {
    el.open("OTA");
    expect(logs).toHaveBeenCalledTimes(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const restart = (el as any)._toggleShowStates();
    stop.resolve(); // cancel lands while the dialog is still open
    await restart;

    // The toggle respawns with the new --no-states flag.
    expect(logs).toHaveBeenCalledTimes(2);
    expect(stopStream).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._streamId).toBe("stream-2");
  });
});

describe("logs-dialog header source chip", () => {
  function mount(): ESPHomeLogsDialog {
    const el = new ESPHomeLogsDialog();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    el.openPassive();
    await el.updateComplete;
    // Identity _localize in tests returns the key verbatim.
    expect(chipText(el)).toBe("dashboard.logs_source_web_serial");
  });
});

describe("logs-dialog passive Stop/Start pauses serial without rebooting (#526)", () => {
  let el: ESPHomeLogsDialog;
  let logs: ReturnType<typeof vi.fn>;
  let stopStream: ReturnType<typeof vi.fn>;
  let port: { close: ReturnType<typeof vi.fn>; setSignals: ReturnType<typeof vi.fn> };
  let cancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toastError.mockClear();
    el = new ESPHomeLogsDialog();
    logs = vi.fn(() => "stream-1");
    stopStream = vi.fn(() => Promise.resolve());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._api = { logs, stopStream };
    port = {
      close: vi.fn(() => Promise.resolve()),
      setSignals: vi.fn(() => Promise.resolve()),
    };
    cancel = vi.fn();
  });

  // Drive a passive session the way attachSerialLogStream does.
  function startPassive() {
    el.openPassive();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    el.setSerialStream(port as any, cancel as unknown as () => void);
  }

  it("Stop pauses display but keeps the reader + port open (no reopen on resume)", () => {
    startPassive();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onStop();
    // Paused for display, but the reader was NOT cancelled and the port NOT
    // closed — so resuming needs no reopen (which would reboot the device).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._serialPaused).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._streaming).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(port.close).not.toHaveBeenCalled();
  });

  it("Start resumes display and never spawns a backend OTA stream", () => {
    startPassive();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onStop();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onStart();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._serialPaused).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._streaming).toBe(true);
    expect(logs).not.toHaveBeenCalled(); // never the OTA backend stream
    expect(cancel).not.toHaveBeenCalled();
    expect(port.close).not.toHaveBeenCalled();
  });

  it("_startStreaming is a no-op in passive mode (never the OTA backend stream)", () => {
    startPassive();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._startStreaming();
    expect(logs).not.toHaveBeenCalled();
  });

  it("dialog close tears down the serial session and clears the port", () => {
    startPassive();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onDialogHide();
    // The cancel (from streamSerialToDialog) stops the reader and closes the
    // port; the dialog drops its reference so a reopen starts clean.
    expect(cancel).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._serialPort).toBe(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._hasSerialPort).toBe(false);
  });

  it("Reset Device pulses RTS then releases it (auto-reset), without closing the port", async () => {
    startPassive();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  it("non-passive (OTA) Start still spawns a backend stream", () => {
    el.open("OTA");
    expect(logs).toHaveBeenCalledTimes(1); // initial OTA subscription
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onStop();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onStart();
    expect(logs).toHaveBeenCalledTimes(2); // OTA path intact
  });

  it("Start reconnects (not OTA) when the reader is gone after a reopen failure", () => {
    const reconnect = vi.fn(() => Promise.resolve());
    el.openPassive({ onReconnect: reconnect });
    // A post-install reopen failure tears the reader down and tells the user
    // to click Start to reconnect (#636).
    el.setSerialOpenFailed("reopen failed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._serialCancel).toBe(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onStart();
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(logs).not.toHaveBeenCalled(); // reconnect, never an OTA stream
  });

  it("Reset Device resumes a paused log so the boot output shows", async () => {
    startPassive();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onStop(); // user had Stopped (paused) the log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any)._onResetDevice();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._serialPaused).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._streaming).toBe(true);
    expect(port.setSignals).toHaveBeenCalled();
  });

  it("Reset Device toasts when the reset pulse fails (cable pulled)", async () => {
    port.setSignals = vi.fn(() => Promise.reject(new Error("device gone")));
    startPassive();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any)._onResetDevice();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("honors a pause set during an in-flight reconnect (setSerialStream keeps _serialPaused)", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    // The user hit Stop while an async reconnect was still in flight.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._serialPaused = true;
    // The reconnect resolves and re-attaches; it must not re-show the log.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    el.setSerialStream(port as any, cancel as unknown as () => void);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._serialPaused).toBe(true);
  });

  it("tears down a late attach after the dialog closed (no port leak)", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onDialogHide(); // dialog closed while an attach was in flight
    const lateCancel = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    el.setSerialStream(port as any, lateCancel as unknown as () => void);
    expect(lateCancel).toHaveBeenCalledTimes(1); // torn down, not registered
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._serialPort).toBe(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._serialCancel).toBe(null);
  });

  it("tears down a late passive attach after switching to an OTA session", () => {
    el.openPassive();
    el.open("OTA"); // switched to non-passive before the attach landed
    const lateCancel = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    el.setSerialStream(port as any, lateCancel as unknown as () => void);
    expect(lateCancel).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._serialPort).toBe(null);
  });

  it("tracks port presence so Reset Device can disable itself", () => {
    el.openPassive();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._hasSerialPort).toBe(false); // settle window: no port yet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    el.setSerialStream(port as any, cancel as unknown as () => void);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._hasSerialPort).toBe(true);
    el.setSerialOpenFailed("gone");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._hasSerialPort).toBe(false);
  });
});
