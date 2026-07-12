// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/web-serial.js", () => ({
  isPortPickerCancel: vi.fn(() => false),
}));
vi.mock("../../src/web/install/run-flash.js", () => ({ runFlash: vi.fn() }));
vi.mock("../../src/util/serial-log-stream.js", () => ({
  streamSerialLines: vi.fn(() => vi.fn()),
}));
vi.mock("../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../src/components/ansi-log.js", () => ({}));

const openLiveLogPort = vi.fn();
vi.mock("../../src/web/flash-receiver/live-log-port.js", () => ({
  openLiveLogPort: (...args: unknown[]) => openLiveLogPort(...args),
}));

import { streamSerialLines } from "../../src/util/serial-log-stream.js";
import { ESPHomeWebFlashReceiver } from "../../src/web/flash-receiver/esphome-web-flash-receiver.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function mount(): Promise<ESPHomeWebFlashReceiver> {
  const el = new ESPHomeWebFlashReceiver();
  (el as any)._localize = (k: string) => k;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function makePort(overrides: Record<string, unknown> = {}) {
  return {
    readable: {},
    setSignals: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("esphome-web-flash-receiver live-log stop race", () => {
  it("does not start streaming when Stop lands during the setSignals await", async () => {
    const el = await mount();

    const port = makePort({
      // Simulate the user pressing Stop mid-await: _logCancel?.() is a no-op
      // because no reader is attached yet.
      setSignals: vi.fn(async () => {
        (el as any)._stopLogs = true;
      }),
    });
    openLiveLogPort.mockResolvedValue({ port, error: null });

    await (el as any)._streamLogs({}, []);
    await el.updateComplete;

    expect(streamSerialLines).not.toHaveBeenCalled();
    expect(port.close).toHaveBeenCalledOnce();
    expect((el as any)._streaming).toBe(false);
  });

  it("streams when Stop is not pressed", async () => {
    const el = await mount();

    const port = makePort();
    openLiveLogPort.mockResolvedValue({ port, error: null });

    await (el as any)._streamLogs({}, []);
    await el.updateComplete;

    expect(streamSerialLines).toHaveBeenCalledOnce();
    expect(port.close).not.toHaveBeenCalled();
    expect((el as any)._logCancel).toBeTypeOf("function");
  });
});

describe("esphome-web-flash-receiver behaviour", () => {
  it("names the tab and card header from the firmware's deviceName", async () => {
    const el = await mount();
    (el as any)._localize = (k: string, p?: Record<string, string>) =>
      p?.name ? `${k}:${p.name}` : k;

    (el as any)._onFirmware({
      type: "esphome-web-flash:firmware",
      nonce: "n",
      deviceName: "Kitchen Sensor",
      parts: [{ address: 0, data: new ArrayBuffer(4) }],
    });

    expect((el as any)._deviceName).toBe("Kitchen Sensor");
    expect(document.title).toContain("Kitchen Sensor");
  });

  it("clears the done state when a new file is picked (no-opener re-flash)", async () => {
    const el = await mount();
    (el as any)._flashDone = true;

    (el as any)._onFileChange();

    expect((el as any)._flashDone).toBe(false);
  });

  it("prints a Terminal disconnected line when the log stream drops", async () => {
    const el = await mount();
    (el as any)._streaming = true;

    (el as any)._onLogDisconnect();

    expect((el as any)._streaming).toBe(false);
    expect((el as any)._logLines).toContain("web.logs.terminal_disconnected");
  });

  it("shows a terminal error state when the hand-off times out", async () => {
    vi.useFakeTimers();
    const openerPost = vi.fn();
    Object.defineProperty(window, "opener", {
      value: { postMessage: openerPost },
      configurable: true,
    });
    const origHash = window.location.hash;
    window.location.hash = "#nonce=n1";
    try {
      const el = new ESPHomeWebFlashReceiver();
      (el as any)._localize = (k: string) => k;
      document.body.appendChild(el);

      vi.advanceTimersByTime(10000);
      await el.updateComplete;

      expect((el as any)._state).toBe("error");
      expect((el as any)._statusMessage).toBe("web.flash.handoff_timeout");
    } finally {
      window.location.hash = origHash;
      delete (window as any).opener;
      vi.useRealTimers();
    }
  });
});
