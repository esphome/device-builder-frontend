/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  call,
  closeDialog,
  ESPHomeLogsDialog,
  makeLogsDialog,
  paused,
  session,
  streaming,
  toastError,
} from "./_logs-dialog-env.js";

import { flush } from "../_dom.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";
import {
  type SerialResetHook,
  startOtaStream,
} from "../../src/components/logs-dialog/session.js";
import { hasSerialPort } from "../../src/components/logs-session.js";
import { crashCalloutStyles } from "../../src/components/process-terminal/crash-callout.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
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
    stop = deferred();
    let n = 0;
    logs = vi.fn(() => `stream-${++n}`);
    stopStream = vi.fn(() => stop.promise);
    el = makeLogsDialog({ logs, stopStream }, { mount: false });
  });

  it("does not respawn a stream when the dialog is closed mid-restart", async () => {
    el.open("OTA");
    expect(logs).toHaveBeenCalledTimes(1); // initial subscription
    expect((el as any)._open).toBe(true);

    // Flip the states toggle: awaits the stopStream cancel before respawning.
    const restart = call(el, "_toggleShowStates");

    // The user closes the dialog while the cancel round-trip is outstanding.
    closeDialog(el);
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

  it("respawns a typed-address session against the same target", async () => {
    el.open("192.168.5.243");
    expect(logs).toHaveBeenLastCalledWith(
      expect.anything(),
      "192.168.5.243",
      expect.anything(),
      expect.anything()
    );

    const restart = call(el, "_toggleShowStates");
    stop.resolve();
    await restart;

    expect(logs).toHaveBeenCalledTimes(2);
    expect(logs).toHaveBeenLastCalledWith(
      expect.anything(),
      "192.168.5.243",
      expect.anything(),
      expect.anything()
    );
    expect(session(el)).toMatchObject({ kind: "ota", port: "192.168.5.243" });
  });
});

describe("logs-dialog OTA stale-callback guard", () => {
  it("ignores onResult from a torn-down stream so it can't stop its replacement", () => {
    const handlers: { onResult: () => void }[] = [];
    let n = 0;
    const el = makeLogsDialog(
      {
        logs: (_c: string, _p: string, cb: { onResult: () => void }) => {
          handlers.push(cb);
          return `stream-${++n}`;
        },
      },
      { mount: false }
    );

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
  const mount = (): ESPHomeLogsDialog => makeLogsDialog();

  function chipText(el: ESPHomeLogsDialog): string {
    return el.shadowRoot!.querySelector(".source-chip")?.textContent?.trim() ?? "";
  }

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

const alwaysHook: SerialResetHook = {
  supports: () => true,
  run: () => Promise.resolve(),
};

describe("logs-dialog Reset Device gate", () => {
  async function mountPassive(
    targetPlatform: string,
    options: { onResetDevice?: SerialResetHook } = {}
  ): Promise<ESPHomeLogsDialog> {
    const el = makeLogsDialog();
    el.configuration = "device.yaml";
    (el as any)._devices = [
      makeConfiguredDevice({
        configuration: "device.yaml",
        target_platform: targetPlatform,
      }),
    ];
    el.openPassive({ onReconnect: () => Promise.resolve(), ...options });
    await el.updateComplete;
    return el;
  }

  const hasResetButton = (el: ESPHomeLogsDialog): boolean =>
    [...el.shadowRoot!.querySelectorAll(".term-btn__label")].some(
      (span) => span.textContent?.trim() === "dashboard.logs_reset_device"
    );

  it("shows Reset Device for an ESP passive session", async () => {
    expect(hasResetButton(await mountPassive("esp32"))).toBe(true);
  });

  it("hides Reset Device for a Pico passive session", async () => {
    expect(hasResetButton(await mountPassive("rp2"))).toBe(false);
  });

  it("shows Reset Device for a Pico when the session supplies a reset hook", async () => {
    const el = await mountPassive("rp2", { onResetDevice: alwaysHook });
    expect(hasResetButton(el)).toBe(true);
  });

  it("hides Reset Device when the hook does not support the attached port", async () => {
    const el = await mountPassive("rp2", {
      onResetDevice: { ...alwaysHook, supports: () => false },
    });
    el.setSerialStream({ close: vi.fn(), setSignals: vi.fn() } as any, async () => {});
    await el.updateComplete;
    expect(hasResetButton(el)).toBe(false);
  });
});

describe("logs-dialog States toggle gate (#539)", () => {
  const mount = (): ESPHomeLogsDialog => makeLogsDialog();

  // The States toggle is the only toolbar control with aria-pressed.
  const hasStatesToggle = (el: ESPHomeLogsDialog): boolean =>
    el.shadowRoot!.querySelector("[aria-pressed]") !== null;

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
    logs = vi.fn(() => "stream-1");
    el = makeLogsDialog(
      { logs, stopStream: vi.fn(() => Promise.resolve()) },
      { mount: false }
    );
    port = makePort();
    cancel = vi.fn();
  });

  const makePort = () => ({
    close: vi.fn(() => Promise.resolve()),
    setSignals: vi.fn(() => Promise.resolve()),
  });

  // Drive a live passive session the way attachSerialLogStream does.
  function startPassive() {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    el.setSerialStream(port as any, cancel as unknown as () => Promise<void>);
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
    // startOtaStream only fires from a stopped OTA session.
    startOtaStream(el);
    expect(logs).not.toHaveBeenCalled();
  });

  it("dialog close tears down the serial session (closes port, returns to idle)", () => {
    startPassive();
    closeDialog(el);
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

  it("Reset Device runs the session hook on the closed port instead of the pulse", async () => {
    cancel = vi.fn(async () => {});
    const fresh = makePort();
    const run = vi.fn(async (p: SerialPort, cancelled: () => boolean) => {
      expect(cancel).toHaveBeenCalledOnce(); // reader stopped and port closed first
      expect(p).toBe(port);
      expect(session(el).kind).toBe("reconnecting");
      expect(cancelled()).toBe(false);
      el.setSerialStream(
        fresh as any,
        vi.fn(async () => {})
      );
      expect(cancelled()).toBe(true); // the session moved on
    });
    el.openPassive({
      onReconnect: () => Promise.resolve(),
      onResetDevice: { ...alwaysHook, run },
    });
    el.setSerialStream(port as any, cancel as unknown as () => Promise<void>);
    await (el as any)._onResetDevice();
    expect(run).toHaveBeenCalledOnce();
    expect(port.setSignals).not.toHaveBeenCalled();
    expect(session(el)).toMatchObject({ kind: "serial", port: fresh, paused: false });
  });

  it.each([
    ["rejects unhandled", () => Promise.reject(new Error("boom"))],
    ["ends without a stream", () => Promise.resolve()],
  ])("drops to dead with a toast when the reset hook %s", async (_case, run) => {
    el.openPassive({
      onReconnect: () => Promise.resolve(),
      onResetDevice: { ...alwaysHook, run },
    });
    el.setSerialStream(port as any, cancel as unknown as () => Promise<void>);
    await (el as any)._onResetDevice();
    expect(session(el).kind).toBe("dead");
    expect(toastError).toHaveBeenCalledOnce();
  });

  // A reset whose hook is parked on a gate, exposing the hook's `cancelled`.
  async function startGatedReset() {
    const gate = deferred();
    let seen!: () => boolean;
    const run = vi.fn(async (_p: SerialPort, cancelled: () => boolean) => {
      seen = cancelled;
      await gate.promise;
    });
    el.openPassive({
      onReconnect: () => Promise.resolve(),
      onResetDevice: { ...alwaysHook, run },
    });
    el.setSerialStream(port as any, cancel as unknown as () => Promise<void>);
    const reset = (el as any)._onResetDevice() as Promise<void>;
    await flush(); // past the awaited cancel; the hook is now parked
    expect(run).toHaveBeenCalledOnce();
    return { gate, reset, cancelled: () => seen() };
  }

  it("hands the opener a predicate that trips once this session is gone", () => {
    const cancelled = el.openPassive({ onReconnect: () => Promise.resolve() });
    expect(cancelled()).toBe(false);
    closeDialog(el);
    expect(cancelled()).toBe(true);
    el.openPassive({ onReconnect: () => Promise.resolve() }); // a new session
    expect(cancelled()).toBe(true);
  });

  it("cancels an in-flight reset as soon as the close is requested", async () => {
    const { gate, reset, cancelled } = await startGatedReset();
    expect(cancelled()).toBe(false);
    closeDialog(el); // X pressed; the hide animation has not even finished
    expect(cancelled()).toBe(true);
    gate.resolve();
    await reset;
    expect(toastError).not.toHaveBeenCalled();
  });

  it("cancels a reset once the dialog was closed and reopened, sparing the new session", async () => {
    const { gate, reset, cancelled } = await startGatedReset();
    closeDialog(el);
    el.openPassive({ onReconnect: () => Promise.resolve() }); // a new session
    expect(cancelled()).toBe(true); // not the session it started in
    gate.resolve();
    await reset;
    expect(session(el).kind).toBe("reconnecting"); // the new session, untouched
    expect(toastError).not.toHaveBeenCalled();
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
    el.setSerialStream(port as any, cancel as unknown as () => Promise<void>);
    expect(session(el)).toMatchObject({ kind: "serial", paused: true });
  });

  it("tears down a late attach after the dialog closed (no port leak)", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    closeDialog(el); // closed while an attach was in flight
    const lateCancel = vi.fn();
    el.setSerialStream(port as any, lateCancel as unknown as () => Promise<void>);
    expect(lateCancel).toHaveBeenCalledTimes(1); // torn down, not registered
    expect(session(el).kind).toBe("idle");
  });

  it("tears down a late passive attach after switching to an OTA session", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    el.open("OTA"); // switched to non-passive before the attach landed
    const lateCancel = vi.fn();
    el.setSerialStream(port as any, lateCancel as unknown as () => Promise<void>);
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
    closeDialog(el);
    el.setSerialOpenFailed("reopen failed");
    expect(session(el).kind).toBe("idle");
  });

  it("tracks port presence so Reset Device can disable itself", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    expect(hasSerialPort(session(el))).toBe(false); // settle window: no port yet
    el.setSerialStream(port as any, cancel as unknown as () => Promise<void>);
    expect(hasSerialPort(session(el))).toBe(true);
    el.setSerialOpenFailed("gone");
    expect(hasSerialPort(session(el))).toBe(false);
  });

  it("abortSerialReconnect drops to dead with no error line or toast", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    expect(session(el).kind).toBe("reconnecting");
    el.abortSerialReconnect();
    expect(session(el).kind).toBe("dead");
    expect((el as any)._log.lines).toEqual([]); // a cancel isn't a failure
    expect(toastError).not.toHaveBeenCalled();
  });

  it("abortSerialReconnect is a no-op for a non-passive (OTA) session", () => {
    el.open("OTA");
    el.abortSerialReconnect();
    expect(session(el).kind).toBe("ota");
  });
});
describe("logs-dialog crash callout composition", () => {
  it("composes the shared crash-callout styles", () => {
    expect(ESPHomeLogsDialog.styles).toContain(crashCalloutStyles);
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
