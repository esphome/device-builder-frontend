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

import { ESPHomeWebLogsDialog } from "../../src/web/logs/esphome-web-logs-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

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
    b.textContent?.includes("web.logs.reset_device")
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
  });
});
