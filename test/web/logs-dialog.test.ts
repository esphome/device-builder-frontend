// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/base-dialog.js", () => ({}));
vi.mock("../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("../../src/util/serial-log-stream.js", () => ({ streamSerialLines: vi.fn() }));
vi.mock("../../src/util/download-text.js", () => ({ downloadAnsiText: vi.fn() }));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("../../src/util/web-serial.js", () => ({ openLiveSerialPort: vi.fn() }));

const sleep = vi.fn((_ms?: number) => Promise.resolve());
vi.mock("../../src/util/sleep.js", () => ({ sleep: (ms: number) => sleep(ms) }));

import { streamSerialLines } from "../../src/util/serial-log-stream.js";
import { openLiveSerialPort } from "../../src/util/web-serial.js";
import { ESPHomeWebLogsDialog } from "../../src/web/logs/esphome-web-logs-dialog.js";
import { makeWebSerialPort } from "./_make-web-serial-port.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function toolbarLabels(el: ESPHomeWebLogsDialog): string[] {
  return [...el.shadowRoot!.querySelectorAll("button.term-btn .term-btn__label")].map(
    (s) => s.textContent?.trim() ?? ""
  );
}

async function mount(isPico = false): Promise<ESPHomeWebLogsDialog> {
  const el = new ESPHomeWebLogsDialog();
  (el as any)._localize = (k: string) => k;
  el.isPico = isPico;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
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
});

const drainMacrotasks = () => new Promise((r) => setTimeout(r, 0));

describe("esphome-web-logs-dialog", () => {
  it("pulses RTS high→low then settles 1s (legacy ewt-console reset shape)", async () => {
    const el = await mount();
    const setSignals = vi.fn(async () => {});
    el.port = { setSignals } as unknown as SerialPort;

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
  });

  it("shows the reset button for a non-Pico device", async () => {
    const el = await mount(false);
    expect(resetButtons(el).length).toBe(1);
  });

  it("hides the reset button for a Pico (RTS pulse can't reset an RP2040)", async () => {
    const el = await mount(true);
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
    (el as any)._activePort = stale;

    const replaced = vi.fn();
    el.addEventListener("port-replaced", (e) => replaced((e as CustomEvent).detail));

    (el as any)._onDisconnect();
    expect((el as any)._lines).toContain("web.logs.reconnecting");
    await vi.waitFor(() => expect((el as any)._activePort).toBe(live));

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
    (el as any)._activePort = { close: vi.fn(async () => {}) };
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
    (el as any)._activePort = { close: vi.fn(async () => {}) };

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

    for (let i = 0; i < 3; i++) {
      (el as any)._activePort = { close: vi.fn(async () => {}) };
      (el as any)._onDisconnect();
      await vi.waitFor(() => expect((el as any)._streaming).toBe(true));
    }
    (openLiveSerialPort as any).mockClear();
    const last = { close: vi.fn(async () => {}) };
    (el as any)._activePort = last;
    (el as any)._onDisconnect();
    await drainMacrotasks();

    expect(openLiveSerialPort).not.toHaveBeenCalled();
    // The stranded handle is released — nothing else holds a cancel for it.
    expect(last.close).toHaveBeenCalled();
    expect((el as any)._activePort).toBeUndefined();
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
    (el as any)._activePort = { close: vi.fn(async () => {}) };

    (el as any)._onDisconnect();
    await vi.waitFor(() =>
      expect((el as any)._lines).toContain("web.logs.reconnect_failed")
    );
    expect((el as any)._streaming).toBe(false);
  });

  it("closing the dialog releases a handle orphaned by a dead stream", async () => {
    const el = await mount();
    const orphan = { close: vi.fn(async () => {}) };
    (el as any)._activePort = orphan;
    (el as any)._cancel = undefined;

    (el as any)._stop();

    expect(orphan.close).toHaveBeenCalled();
  });

  it("a line arriving after a resume resets the give-up counter", async () => {
    const el = await mount();
    let hooks: any;
    (streamSerialLines as any).mockImplementation((_p: unknown, h: unknown) => {
      hooks = h;
      return vi.fn();
    });
    (openLiveSerialPort as any).mockResolvedValue({
      readable: {},
      close: vi.fn(async () => {}),
    });
    el.open = true;
    (el as any)._activePort = { close: vi.fn(async () => {}) };

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
    (el as any)._activePort = { close: vi.fn(async () => {}) };

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

  it("ignores a port swap while a disconnect recovery is in flight", async () => {
    const el = await mount();
    el.port = makeWebSerialPort();
    el.open = true;
    await el.updateComplete;
    expect(streamSerialLines).toHaveBeenCalledOnce();

    // The reconnect window: reader gone (_cancel cleared) but the active
    // handle retained; a parent watcher swapping .port here must not wipe
    // the rendered lines or race a second reader against the resume.
    (el as any)._cancel = undefined;
    el.port = makeWebSerialPort();
    await el.updateComplete;
    expect(streamSerialLines).toHaveBeenCalledOnce();
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
});
