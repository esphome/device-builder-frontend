// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

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
    const live = { readable: {} };
    (openLiveSerialPort as any).mockImplementation(async () => {
      order.push("reopen");
      return live;
    });
    el.open = true;
    (el as any)._activePort = stale;

    (el as any)._onDisconnect();
    expect((el as any)._lines).toContain("web.logs.reconnecting");
    await vi.waitFor(() => expect((el as any)._activePort).toBe(live));

    // The dead handle is closed before any reopen attempt.
    expect(order).toEqual(["close", "reopen"]);
    expect((el as any)._streaming).toBe(true);
    expect(streamSerialLines).toHaveBeenLastCalledWith(live, expect.anything());
    (el as any)._flushPending();
    expect((el as any)._lines).toContain("web.logs.reconnected");
  });

  it("keeps the display paused across an auto-reconnect", async () => {
    const el = await mount();
    (openLiveSerialPort as any).mockResolvedValue({ readable: {} });
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
    (openLiveSerialPort as any).mockResolvedValue({ readable: {} });
    el.open = true;

    for (let i = 0; i < 3; i++) {
      (el as any)._activePort = { close: vi.fn(async () => {}) };
      (el as any)._onDisconnect();
      await vi.waitFor(() => expect((el as any)._streaming).toBe(true));
    }
    (openLiveSerialPort as any).mockClear();
    (el as any)._activePort = { close: vi.fn(async () => {}) };
    (el as any)._onDisconnect();
    await drainMacrotasks();

    expect(openLiveSerialPort).not.toHaveBeenCalled();
    (el as any)._flushPending();
    expect((el as any)._lines).toContain("web.logs.reconnect_failed");
  });

  it("a line arriving after a resume resets the give-up counter", async () => {
    const el = await mount();
    let hooks: any;
    (streamSerialLines as any).mockImplementation((_p: unknown, h: unknown) => {
      hooks = h;
      return vi.fn();
    });
    (openLiveSerialPort as any).mockResolvedValue({ readable: {} });
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
    el.port = { readable: {} } as unknown as SerialPort;
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
    el.port = { readable: {} } as unknown as SerialPort;
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
});
