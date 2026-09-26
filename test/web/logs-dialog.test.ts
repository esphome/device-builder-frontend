// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/components/base-dialog.js", () => ({}));
vi.mock("../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("../../src/util/serial-log-stream.js", () => ({ streamSerialLines: vi.fn() }));
vi.mock("../../src/util/download-text.js", () => ({ downloadAnsiText: vi.fn() }));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("../../src/util/serial-reacquire.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openLiveSerialPort: vi.fn(),
}));
vi.mock("../../src/platforms/rp2/rp2-logs-reset.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/platforms/rp2/rp2-logs-reset.js")>()),
  rebootPico: vi.fn(),
}));
vi.mock("../../src/platforms/nrf52/ble-nus-stream.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  streamBleNus: vi.fn(),
}));

const sleep = vi.fn((_ms?: number) => Promise.resolve());
vi.mock("../../src/util/sleep.js", () => ({ sleep: (ms: number) => sleep(ms) }));

import toast from "sonner-js";
import { crashCalloutStyles } from "../../src/components/process-terminal/crash-callout.js";
import { streamBleNus } from "../../src/platforms/nrf52/ble-nus-stream.js";
import { PicoStrandedError, rebootPico } from "../../src/platforms/rp2/rp2-logs-reset.js";
import { streamSerialLines } from "../../src/util/serial-log-stream.js";
import { openLiveSerialPort } from "../../src/util/serial-reacquire.js";
import { BleLogSource } from "../../src/web/logs/ble-source.js";
import { ESPHomeWebLogsDialog } from "../../src/web/logs/esphome-web-logs-dialog.js";
import { RTS_PULSE, type WebSerialReset } from "../../src/web/logs/logs-policy.js";
import { SerialLogSource } from "../../src/web/logs/serial-source.js";
import { PICO_RESET } from "../../src/web/platforms/rp2/logs-policy.js";
import { makeWebSerialPort } from "./_make-web-serial-port.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function toolbarLabels(el: ESPHomeWebLogsDialog): string[] {
  return [...el.shadowRoot!.querySelectorAll("button.term-btn .term-btn__label")].map(
    (s) => s.textContent?.trim() ?? ""
  );
}

// ``null`` for a card with no reset (a default argument would turn undefined into the pulse).
async function mount(
  reset: WebSerialReset | null = RTS_PULSE
): Promise<ESPHomeWebLogsDialog> {
  const el = new ESPHomeWebLogsDialog();
  (el as any)._localize = (k: string) => k;
  el.policy = reset ? { reset } : {};
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

// A serial session already streaming ``port`` (the reader is the mocked
// streamSerialLines), the state a mid-stream drop starts from.
function serialSession(
  el: ESPHomeWebLogsDialog,
  port: unknown,
  reset: WebSerialReset = RTS_PULSE
): SerialLogSource {
  const source = new SerialLogSource(port as SerialPort, {
    reset,
    // What the dialog's own source wiring does with a recovered handle.
    onPortReplaced: (live) =>
      el.dispatchEvent(new CustomEvent("port-replaced", { detail: live, bubbles: true })),
  });
  source.activePort = port as SerialPort;
  (el as any)._source = source;
  return source;
}

function resetButtons(el: ESPHomeWebLogsDialog): Element[] {
  return [...el.shadowRoot!.querySelectorAll("button.term-btn")].filter((b) =>
    b.textContent?.includes("dashboard.logs_reset_device")
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  // resetAllMocks (not clearAllMocks): per-test mockResolvedValue
  // implementations must not leak into later tests.
  vi.resetAllMocks();
});

// resetAllMocks strips module-level spy implementations too; restore the
// sleep stub so callers awaiting it keep getting a promise.
beforeEach(() => {
  sleep.mockImplementation((_ms?: number) => Promise.resolve());
  // The real reader always hands back a cancel; the source treats a missing
  // one as a failed attach or resume.
  vi.mocked(streamSerialLines).mockImplementation(() => vi.fn(async () => {}));
});

const drainMacrotasks = () => new Promise((r) => setTimeout(r, 0));

describe("esphome-web-logs-dialog", () => {
  it("pulses RTS high→low then settles 1s (legacy ewt-console reset shape)", async () => {
    const el = await mount();
    const setSignals = vi.fn(async () => {});
    serialSession(el, { setSignals, close: vi.fn(async () => {}) });

    await (el as any)._resetDevice();

    expect(setSignals).toHaveBeenNthCalledWith(1, {
      dataTerminalReady: false,
      requestToSend: true,
    });
    expect(setSignals).toHaveBeenNthCalledWith(2, {
      dataTerminalReady: false,
      requestToSend: false,
    });
    expect(sleep).toHaveBeenCalledWith(1000);
    (el as any)._flushPending();
    expect((el as any)._lines.slice(-2)).toEqual(["", "serial.resetting"]);
  });

  // The Pico's Reset Device: the stream ends, the routine touches into
  // BOOTSEL and reboots over WebUSB, and the re-enumerated CDC port comes
  // back through the same resume as a dropped stream.
  function picoSession(el: ESPHomeWebLogsDialog) {
    el.open = true;
    const port = makeWebSerialPort();
    const cancel = vi.fn(async () => {});
    serialSession(el, port, PICO_RESET);
    (el as any)._cancel = cancel;
    return { port, cancel };
  }

  it("reboots a Pico through the routine and resumes on the returned port", async () => {
    const el = await mount(PICO_RESET);
    const { port, cancel } = picoSession(el);
    const live = makeWebSerialPort();
    vi.mocked(rebootPico).mockResolvedValue(true);
    (openLiveSerialPort as any).mockResolvedValue(live);
    const replaced = vi.fn();
    el.addEventListener("port-replaced", (e) => replaced((e as CustomEvent).detail));

    await (el as any)._resetDevice();

    expect(cancel).toHaveBeenCalledOnce();
    expect(rebootPico).toHaveBeenCalledWith(port, expect.any(Function));
    expect(openLiveSerialPort).toHaveBeenCalledWith(
      port,
      expect.objectContaining({ bufferSize: 8192 })
    );
    expect(streamSerialLines).toHaveBeenLastCalledWith(live, expect.anything());
    expect(replaced).toHaveBeenCalledWith(live);
    expect((el as any)._streaming).toBe(true);
    (el as any)._flushPending();
    expect((el as any)._lines).toContain("serial.resetting");
    expect((el as any)._lines).toContain("web.logs.reconnected");
  });

  it("prints no reset marker while the port is still being reacquired", async () => {
    const el = await mount(PICO_RESET);
    picoSession(el);
    (el as any)._cancel = undefined; // a reconnect or an earlier reset in flight
    await (el as any)._resetDevice();
    (el as any)._flushPending();
    expect(rebootPico).not.toHaveBeenCalled();
    expect((el as any)._lines).not.toContain("serial.resetting");
  });

  it.each([
    { why: "the reboot leaves it stranded", stranded: true },
    { why: "it never comes back", stranded: false },
  ])("ends the session when $why", async ({ stranded }) => {
    const el = await mount(PICO_RESET);
    picoSession(el);
    if (stranded) vi.mocked(rebootPico).mockRejectedValue(new PicoStrandedError("pick"));
    else {
      vi.mocked(rebootPico).mockResolvedValue(true);
      (openLiveSerialPort as any).mockResolvedValue(null);
    }
    await (el as any)._resetDevice();
    if (stranded)
      expect(toast.error).toHaveBeenCalledWith("dashboard.logs_rp2_reset_stranded");
    (el as any)._flushPending();
    expect((el as any)._lines).toContain("web.logs.reconnect_failed");
    expect((el as any)._streaming).toBe(false);
    expect((el as any)._source).toBeUndefined();
  });

  it("ignores a second Reset click while the reboot is still reacquiring the port", async () => {
    const el = await mount(PICO_RESET);
    picoSession(el);
    let finish!: (rebooted: boolean) => void;
    vi.mocked(rebootPico).mockReturnValue(new Promise((r) => (finish = r)));
    (openLiveSerialPort as any).mockResolvedValue(makeWebSerialPort());
    const first = (el as any)._resetDevice();
    await (el as any)._resetDevice();
    // The first reset reaches the routine after releasing the stream.
    await new Promise((r) => setTimeout(r, 0));
    expect(rebootPico).toHaveBeenCalledOnce();
    finish(true);
    await first;
    expect((el as any)._streaming).toBe(true);
  });

  it("disables Reset Device until a stream is live", async () => {
    const el = await mount();
    await el.updateComplete;
    expect((resetButtons(el)[0] as HTMLButtonElement).disabled).toBe(true);
    (el as any)._cancel = async () => {};
    await el.updateComplete;
    expect((resetButtons(el)[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers the Pico reset only where WebUSB exists", async () => {
    expect(resetButtons(await mount(PICO_RESET)).length).toBe(0);
    Object.defineProperty(navigator, "usb", { configurable: true, value: {} });
    try {
      expect(resetButtons(await mount(PICO_RESET)).length).toBe(1);
    } finally {
      delete (navigator as any).usb;
    }
  });

  it("shows the reset button for a non-Pico device", async () => {
    const el = await mount();
    expect(resetButtons(el).length).toBe(1);
  });

  it("hides the reset button when the card says so (no reset line behind the CDC)", async () => {
    const el = await mount(null);
    expect(resetButtons(el).length).toBe(0);
  });

  it("prints a Terminal disconnected line when the device drops the stream", async () => {
    const el = await mount();

    (el as any)._onDisconnect();
    expect((el as any)._streaming).toBe(false);
    expect((el as any)._lines).toContain("web.logs.terminal_disconnected");

    (el as any)._onDisconnect(new Error("cable"));
    expect((el as any)._lines.some((l: string) => l.includes("cable"))).toBe(true);
    // Reader ended → no Stop/Start button (neither streaming nor paused).
    expect((el as any)._paused).toBe(false);
    await el.updateComplete;
    expect(toolbarLabels(el)).not.toContain("dashboard.logs_start");
  });

  it("closes the dead port, reopens, and resumes streaming", async () => {
    const el = await mount();
    const order: string[] = [];
    const stale = { close: vi.fn(async () => order.push("close")) };
    const live = { readable: {}, close: vi.fn(async () => {}) };
    (openLiveSerialPort as any).mockImplementation(async () => {
      order.push("reopen");
      return live;
    });
    el.open = true;
    const source = serialSession(el, stale);

    const replaced = vi.fn();
    el.addEventListener("port-replaced", (e) => replaced((e as CustomEvent).detail));

    (el as any)._onDisconnect();
    expect((el as any)._lines).toContain("web.logs.reconnecting");
    await vi.waitFor(() => expect(source.activePort).toBe(live));

    // The dead handle is closed before any reopen attempt.
    expect(order).toEqual(["close", "reopen"]);
    expect((el as any)._streaming).toBe(true);
    expect(streamSerialLines).toHaveBeenLastCalledWith(live, expect.anything());
    // The recovered handle is announced to the parent card.
    await vi.waitFor(() => expect(replaced).toHaveBeenCalledWith(live));
    (el as any)._flushPending();
    expect((el as any)._lines).toContain("web.logs.reconnected");
  });

  it("keeps the display paused across an auto-reconnect", async () => {
    const el = await mount();
    (openLiveSerialPort as any).mockResolvedValue({
      readable: {},
      close: vi.fn(async () => {}),
    });
    el.open = true;
    serialSession(el, { close: vi.fn(async () => {}) });
    (el as any)._paused = true;

    (el as any)._onDisconnect();
    await vi.waitFor(() => expect((el as any)._lines).toContain("web.logs.reconnected"));

    expect((el as any)._paused).toBe(true);
    expect((el as any)._streaming).toBe(false);
  });

  it("ends the terminal when the device stays gone", async () => {
    const el = await mount();
    (openLiveSerialPort as any).mockResolvedValue(null);
    el.open = true;
    serialSession(el, { close: vi.fn(async () => {}) });

    (el as any)._onDisconnect();
    await vi.waitFor(() =>
      expect((el as any)._lines).toContain("web.logs.reconnect_failed")
    );
    expect((el as any)._streaming).toBe(false);
  });

  it("gives up after consecutive reconnects that never produce a line", async () => {
    const el = await mount();
    (openLiveSerialPort as any).mockResolvedValue({
      readable: {},
      close: vi.fn(async () => {}),
    });
    el.open = true;
    const source = serialSession(el, { close: vi.fn(async () => {}) });

    for (let i = 0; i < 3; i++) {
      source.activePort = { close: vi.fn(async () => {}) } as unknown as SerialPort;
      (el as any)._onDisconnect();
      await vi.waitFor(() => expect((el as any)._streaming).toBe(true));
    }
    (openLiveSerialPort as any).mockClear();
    const last = { close: vi.fn(async () => {}) };
    source.activePort = last as unknown as SerialPort;
    (el as any)._onDisconnect();
    await drainMacrotasks();

    expect(openLiveSerialPort).not.toHaveBeenCalled();
    // The stranded handle is released — nothing else holds a cancel for it.
    expect(last.close).toHaveBeenCalled();
    expect(source.activePort).toBeUndefined();
    (el as any)._flushPending();
    expect((el as any)._lines).toContain("web.logs.reconnect_gave_up");
  });

  it("a throw in the resume tail ends as reconnect_failed, not a stuck spinner", async () => {
    const el = await mount();
    (openLiveSerialPort as any).mockResolvedValue({
      readable: {},
      close: vi.fn(async () => {}),
    });
    (streamSerialLines as any).mockImplementation(() => {
      throw new TypeError("stream already locked");
    });
    el.open = true;
    serialSession(el, { close: vi.fn(async () => {}) });

    (el as any)._onDisconnect();
    await vi.waitFor(() =>
      expect((el as any)._lines).toContainEqual(
        expect.stringContaining("web.logs.reconnect_failed")
      )
    );
    expect((el as any)._lines).toContainEqual(
      expect.stringContaining("stream already locked")
    );
    expect((el as any)._streaming).toBe(false);
  });

  it("closing the dialog releases a handle orphaned by a dead stream", async () => {
    const el = await mount();
    const orphan = { close: vi.fn(async () => {}) };
    serialSession(el, orphan);
    (el as any)._cancel = undefined;

    (el as any)._stop();

    expect(orphan.close).toHaveBeenCalled();
  });

  it("a line arriving after a resume resets the give-up counter", async () => {
    const el = await mount();
    let hooks: any;
    (streamSerialLines as any).mockImplementation((_p: unknown, h: unknown) => {
      hooks = h;
      return vi.fn(async () => {});
    });
    (openLiveSerialPort as any).mockResolvedValue({
      readable: {},
      close: vi.fn(async () => {}),
    });
    el.open = true;
    serialSession(el, { close: vi.fn(async () => {}) });

    (el as any)._onDisconnect();
    await vi.waitFor(() => expect((el as any)._streaming).toBe(true));
    hooks.onLine("boot line");

    expect((el as any)._silentReconnects).toBe(0);
  });

  it("a close during the reacquire window cancels the resume", async () => {
    const el = await mount();
    let resolve: (v: unknown) => void;
    (openLiveSerialPort as any).mockReturnValue(new Promise((r) => (resolve = r)));
    el.open = true;
    serialSession(el, { close: vi.fn(async () => {}) });

    (el as any)._onDisconnect();
    await drainMacrotasks();
    (el as any)._stop();
    const late = { readable: {}, close: vi.fn(async () => {}) };
    resolve!(late);
    await drainMacrotasks();

    expect((el as any)._streaming).toBe(false);
    // The superseded resume reclaims the handle it opened.
    expect(late.close).toHaveBeenCalled();
    (el as any)._flushPending();
    expect((el as any)._lines).not.toContain("web.logs.reconnected");
  });

  it("renders a Clear label and toggles Stop ⇄ Start", async () => {
    const el = await mount();
    el.port = makeWebSerialPort();
    el.open = true;
    // _start() flips _streaming inside updated(), which schedules a second
    // render — await both cycles before asserting on the toolbar.
    await el.updateComplete;
    await el.updateComplete;

    // Streaming: Clear has a text label and the Stop button shows.
    expect(toolbarLabels(el)).toContain("dashboard.logs_clear");
    expect(toolbarLabels(el)).toContain("dashboard.logs_stop");
    expect((el as any)._streaming).toBe(true);

    (el as any)._onStop();
    await el.updateComplete;
    expect((el as any)._streaming).toBe(false);
    expect((el as any)._paused).toBe(true);
    expect(toolbarLabels(el)).toContain("dashboard.logs_start");
    expect(toolbarLabels(el)).not.toContain("dashboard.logs_stop");

    (el as any)._onStart();
    await el.updateComplete;
    expect((el as any)._streaming).toBe(true);
    expect(toolbarLabels(el)).toContain("dashboard.logs_stop");
  });

  it("drops incoming lines while paused, keeps them while streaming", async () => {
    const el = await mount();
    el.port = makeWebSerialPort();
    el.open = true;
    await el.updateComplete;

    const calls = vi.mocked(streamSerialLines).mock.calls;
    const hooks = calls[calls.length - 1][1];
    hooks.onLine("live line");
    expect((el as any)._pendingLines).toContain("live line");

    (el as any)._onStop();
    hooks.onLine("paused line");
    expect((el as any)._pendingLines).not.toContain("paused line");
  });

  it("starts streaming when the port arrives after the dialog opened", async () => {
    // The flash receiver's hand-off shape: dialog open while the rebooted
    // device re-enumerates, port assigned once acquired.
    const el = await mount();
    el.open = true;
    await el.updateComplete;
    expect(streamSerialLines).not.toHaveBeenCalled();

    el.port = makeWebSerialPort();
    await el.updateComplete;
    expect(streamSerialLines).toHaveBeenCalledOnce();
    expect((el as any)._streaming).toBe(true);
  });

  it("releases the streaming reader when open and port clear in one batch", async () => {
    // The flash receiver's _runInstall teardown shape: both cleared in a
    // single update. _stop must release via the cancel closure or the source,
    // not this.port (already undefined by then).
    const el = await mount();
    const cancel = vi.fn(async () => {});
    vi.mocked(streamSerialLines).mockReturnValue(cancel);
    el.port = makeWebSerialPort();
    el.open = true;
    await el.updateComplete;
    expect(streamSerialLines).toHaveBeenCalledOnce();

    el.open = false;
    el.port = undefined;
    await el.updateComplete;
    expect(cancel).toHaveBeenCalledOnce();
    expect((el as any)._source).toBeUndefined();
  });

  it("releases the port and forgets the session when the first attach fails", async () => {
    const el = await mount();
    const port = makeWebSerialPort();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(streamSerialLines).mockRejectedValueOnce(new Error("boom"));
    el.port = port;
    el.open = true;
    await el.updateComplete;
    await drainMacrotasks();
    expect((el as any)._streaming).toBe(false);
    expect((el as any)._source).toBeUndefined();
    expect(port.close).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("[Logs] connect failed:", expect.any(Error));
    error.mockRestore();
  });

  it("leaves the recovery's port alone when the first read dies at once", async () => {
    // The reader ends before _attach stores its cancel: the recovery owns
    // the handle from here, and the stale cancel (whose last step closes the
    // port) must not run against the reopened one.
    const el = await mount();
    const port = makeWebSerialPort();
    const staleCancel = vi.fn(async () => {});
    const liveCancel = vi.fn(async () => {});
    vi.mocked(streamSerialLines)
      .mockImplementationOnce((_port, hooks) => {
        hooks.onDisconnect?.();
        return staleCancel;
      })
      .mockReturnValueOnce(liveCancel);
    (openLiveSerialPort as any).mockResolvedValue(port);
    el.port = port;
    el.open = true;
    await el.updateComplete;
    await vi.waitFor(() => expect((el as any)._cancel).toBe(liveCancel));
    await drainMacrotasks();
    expect(staleCancel).not.toHaveBeenCalled();
    expect((el as any)._streaming).toBe(true);
  });

  it("starts a fresh session from a new port after a failed recovery", async () => {
    const el = await mount();
    (openLiveSerialPort as any).mockResolvedValue(null);
    el.open = true;
    serialSession(el, { close: vi.fn(async () => {}) });
    (el as any)._onDisconnect();
    await vi.waitFor(() =>
      expect((el as any)._lines).toContain("web.logs.reconnect_failed")
    );
    expect((el as any)._source).toBeUndefined();
    const next = makeWebSerialPort();
    el.port = next;
    await el.updateComplete;
    expect(streamSerialLines).toHaveBeenLastCalledWith(next, expect.anything());
    expect(next.close).not.toHaveBeenCalled();
    expect((el as any)._streaming).toBe(true);
  });

  it("ignores a closed handle handed in mid-session without closing it", async () => {
    const el = await mount();
    el.open = true;
    serialSession(el, { close: vi.fn(async () => {}) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const closed = makeWebSerialPort({ readable: null });
    el.port = closed;
    await el.updateComplete;
    expect(closed.close).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("toasts a Reset click once the session is gone", async () => {
    const el = await mount();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(streamSerialLines).mockRejectedValueOnce(new Error("boom"));
    el.port = makeWebSerialPort();
    el.open = true;
    await el.updateComplete;
    await drainMacrotasks();
    await (el as any)._resetDevice();
    expect(toast.error).toHaveBeenCalledWith("web.logs.reset_failed");
    vi.mocked(console.error).mockRestore();
  });

  it("ignores a port swap while a disconnect recovery is in flight", async () => {
    const el = await mount();
    el.port = makeWebSerialPort();
    el.open = true;
    await el.updateComplete;
    expect(streamSerialLines).toHaveBeenCalledOnce();

    // The reconnect window: reader gone (_cancel cleared) but the active
    // handle retained; a parent watcher swapping .port here must not wipe
    // the rendered lines or race a second reader against the resume. The
    // declined open foreign handle is released — nothing else ever would.
    (el as any)._cancel = undefined;
    const swapped = makeWebSerialPort();
    el.port = swapped;
    await el.updateComplete;
    expect(streamSerialLines).toHaveBeenCalledOnce();
    expect(swapped.close).toHaveBeenCalledOnce();

    // The port-replaced round trip echoes the dialog's own handle — kept.
    const own = (el as any)._source.activePort as SerialPort;
    el.port = own;
    await el.updateComplete;
    expect(own.close).not.toHaveBeenCalled();
  });

  it("does not latch the crash banner for lines dropped while paused", async () => {
    const el = await mount();
    el.port = makeWebSerialPort();
    el.open = true;
    await el.updateComplete;
    const calls = vi.mocked(streamSerialLines).mock.calls;
    const hooks = calls[calls.length - 1][1];

    (el as any)._onStop();
    hooks.onLine("Guru Meditation Error: Core  1 panic'ed (LoadProhibited)");
    await el.updateComplete;
    // The banner must never claim a crash the terminal has no trace of.
    expect(el.shadowRoot!.querySelector(".crash-callout")).toBeNull();
  });

  it("latches the crash banner on a panic line, upgrading previous-boot to live", async () => {
    const el = await mount();
    el.port = makeWebSerialPort();
    el.open = true;
    await el.updateComplete;
    const calls = vi.mocked(streamSerialLines).mock.calls;
    const hooks = calls[calls.length - 1][1];

    expect(el.shadowRoot!.querySelector(".crash-callout")).toBeNull();

    hooks.onLine("*** CRASH DETECTED - report follows ***");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".crash-callout")?.textContent).toContain(
      "crash_report.banner_previous_boot"
    );

    hooks.onLine("Guru Meditation Error: Core  1 panic'ed (LoadProhibited)");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".crash-callout")?.textContent?.trim()).toBe(
      "crash_report.banner"
    );

    // Clear drops the banner with the lines.
    (el as any)._clear();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".crash-callout")).toBeNull();
  });

  it("drops the crash banner on hide so a portless reopen starts clean", async () => {
    const el = await mount();
    el.port = makeWebSerialPort();
    el.open = true;
    await el.updateComplete;
    const calls = vi.mocked(streamSerialLines).mock.calls;
    calls[calls.length - 1][1].onLine("Guru Meditation Error: Core  1 panic'ed");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".crash-callout")).not.toBeNull();

    (el as any)._onAfterHide();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".crash-callout")).toBeNull();
  });

  it("composes the shared crash-callout styles", () => {
    expect(ESPHomeWebLogsDialog.styles).toContain(crashCalloutStyles);
  });
});

describe("esphome-web-logs-dialog over Bluetooth", () => {
  type Hooks = { onLine: (l: string) => void; onDisconnect?: () => void };
  const device = {} as BluetoothDevice;

  async function openBle(): Promise<{ el: ESPHomeWebLogsDialog; hooks: () => Hooks }> {
    // noReset stays false: Bluetooth hides the button on its own.
    const el = await mount();
    el.bleDevice = device;
    el.open = true;
    await el.updateComplete;
    await drainMacrotasks();
    return {
      el,
      hooks: () => vi.mocked(streamBleNus).mock.calls.slice(-1)[0][1] as Hooks,
    };
  }

  it("connects on open, streams lines and hides the reset button", async () => {
    const cancel = vi.fn(async () => {});
    vi.mocked(streamBleNus).mockResolvedValue(cancel);
    const { el, hooks } = await openBle();
    expect(streamBleNus).toHaveBeenCalledWith(
      device,
      expect.objectContaining({ onLine: expect.any(Function) }),
      expect.objectContaining({ attempts: 3, cancelled: expect.any(Function) })
    );
    expect((el as any)._streaming).toBe(true);
    expect(resetButtons(el).length).toBe(0);
    hooks().onLine("[I][app:1]: hello");
    (el as any)._flushPending();
    expect((el as any)._lines).toContain("[I][app:1]: hello");
    // Closing cancels the subscription, which also drops the link.
    el.open = false;
    await el.updateComplete;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("tells a retrying first connect to stop once the dialog closes", async () => {
    let cancelled!: () => boolean;
    vi.mocked(streamBleNus).mockImplementation(async (_device, _hooks, options) => {
      cancelled = options!.cancelled!;
      return async () => {};
    });
    const { el } = await openBle();
    expect(cancelled()).toBe(false);
    el.open = false;
    await el.updateComplete;
    expect(cancelled()).toBe(true);
  });

  it("prints why a connect failed and stops the spinner", async () => {
    vi.mocked(streamBleNus).mockRejectedValue(new Error("gatt"));
    const { el } = await openBle();
    expect((el as any)._streaming).toBe(false);
    expect((el as any)._lines).toContain("web.logs.connect_failed");
    // The dead session is gone, so the next open starts clean.
    expect((el as any)._source).toBeUndefined();
  });

  it("declines and closes a port handed in over a Bluetooth session", async () => {
    vi.mocked(streamBleNus).mockResolvedValue(async () => {});
    const { el } = await openBle();
    const port = makeWebSerialPort();
    el.port = port;
    await el.updateComplete;
    expect(streamSerialLines).not.toHaveBeenCalled();
    expect(port.close).toHaveBeenCalledOnce();
    expect((el as any)._source).toBeInstanceOf(BleLogSource);
  });

  it("reconnects after the peripheral drops the link", async () => {
    vi.mocked(streamBleNus).mockResolvedValue(async () => {});
    const { el, hooks } = await openBle();
    hooks().onDisconnect!();
    await drainMacrotasks();
    expect(streamBleNus).toHaveBeenCalledTimes(2);
    (el as any)._flushPending();
    expect((el as any)._lines).toContain("web.logs.terminal_disconnected");
    expect((el as any)._lines).toContain("web.logs.reconnected");
    expect((el as any)._streaming).toBe(true);
  });

  it("prints why a reconnect failed, not just that it did", async () => {
    vi.mocked(streamBleNus)
      .mockResolvedValueOnce(async () => {})
      .mockRejectedValueOnce(new Error("no NUS service"));
    const { el, hooks } = await openBle();
    hooks().onDisconnect!();
    await drainMacrotasks();
    (el as any)._flushPending();
    expect((el as any)._lines).toContain("web.logs.reconnect_failed (no NUS service)");
    expect((el as any)._streaming).toBe(false);
  });

  it("gives up after repeated silent drops", async () => {
    vi.mocked(streamBleNus).mockResolvedValue(async () => {});
    const { el, hooks } = await openBle();
    for (let i = 0; i < 4; i++) {
      hooks().onDisconnect!();
      await drainMacrotasks();
    }
    expect((el as any)._lines).toContain("web.logs.reconnect_gave_up");
    expect((el as any)._streaming).toBe(false);
  });

  it("drops a connect that lands after the dialog closed", async () => {
    const cancel = vi.fn(async () => {});
    let resolveConnect!: (c: () => Promise<void>) => void;
    vi.mocked(streamBleNus).mockReturnValue(new Promise((r) => (resolveConnect = r)));
    const { el } = await openBle();
    el.open = false;
    await el.updateComplete;
    resolveConnect(cancel);
    await drainMacrotasks();
    expect(cancel).toHaveBeenCalledOnce();
    expect((el as any)._cancel).toBeUndefined();
  });
});
