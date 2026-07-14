// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/base-dialog.js", () => ({}));
vi.mock("../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("../../src/util/serial-log-stream.js", () => ({ streamSerialLines: vi.fn() }));
vi.mock("../../src/util/download-text.js", () => ({ downloadAnsiText: vi.fn() }));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

const sleep = vi.fn((_ms?: number) => Promise.resolve());
vi.mock("../../src/util/sleep.js", () => ({ sleep: (ms: number) => sleep(ms) }));

import { streamSerialLines } from "../../src/util/serial-log-stream.js";
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
  vi.clearAllMocks();
});

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
