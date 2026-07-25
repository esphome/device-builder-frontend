// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/web-serial.js", () => ({
  isPortPickerCancel: vi.fn(() => false),
}));
vi.mock("../../src/web/install/run-flash.js", () => ({ runFlash: vi.fn() }));
vi.mock("../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../src/components/ansi-log.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("../../src/web/logs/esphome-web-logs-dialog.js", () => ({
  openPortForLogs: vi.fn(async () => true),
}));

const openLiveLogPort = vi.fn();
vi.mock("../../src/web/flash-receiver/live-log-port.js", () => ({
  openLiveLogPort: (...args: unknown[]) => openLiveLogPort(...args),
}));

import toast from "sonner-js";

import { ESPHomeWebFlashReceiver } from "../../src/web/flash-receiver/esphome-web-flash-receiver.js";
import { openPortForLogs } from "../../src/web/logs/esphome-web-logs-dialog.js";

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

describe("esphome-web-flash-receiver boot logs hand-off", () => {
  it("opens the logs dialog immediately and hands it the acquired port", async () => {
    const el = await mount();
    const port = makePort();
    openLiveLogPort.mockImplementation(async () => {
      // The dialog must already be open while the device re-enumerates.
      expect((el as any)._logsOpen).toBe(true);
      return { port, error: null };
    });

    await (el as any)._openBootLogs({}, []);

    expect((el as any)._logPort).toBe(port);
    expect((el as any)._logsOpen).toBe(true);
    expect(port.setSignals).toHaveBeenCalledWith({
      dataTerminalReady: false,
      requestToSend: false,
    });
    expect(port.close).not.toHaveBeenCalled();
  });

  it("keeps acquiring after the dialog closes and parks the handle", async () => {
    // An Escape during the re-enumeration wait must end the same way as one
    // a second later: closed handle in _logPort, Logs button available.
    const el = await mount();
    // A stale handle from a previous install must not survive into this one.
    (el as any)._logPort = makePort();
    const port = makePort();
    openLiveLogPort.mockImplementation(async (...args: unknown[]) => {
      expect((el as any)._logPort).toBeUndefined(); // stale handle cleared
      (el as any)._logsOpen = false; // user closed the dialog mid-wait
      expect((args[4] as () => boolean)()).toBe(false); // acquisition continues
      return { port, error: null };
    });

    await (el as any)._openBootLogs({}, []);

    expect(port.close).toHaveBeenCalledOnce();
    expect((el as any)._logPort).toBe(port);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts and closes the dialog when the device never re-enumerates", async () => {
    const el = await mount();
    openLiveLogPort.mockResolvedValue({ port: null, error: "gone" });

    await (el as any)._openBootLogs({}, []);

    expect((el as any)._logsOpen).toBe(false);
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("closes the port but keeps the handle when the dialog closed mid-setSignals", async () => {
    // An accidental Escape mid-hand-off stays a one-click recovery: the
    // Logs button reopens the kept (closed) handle.
    const el = await mount();
    const port = makePort({
      setSignals: vi.fn(async () => {
        (el as any)._logsOpen = false;
      }),
    });
    openLiveLogPort.mockResolvedValue({ port, error: null });

    await (el as any)._openBootLogs({}, []);

    expect(port.close).toHaveBeenCalledOnce();
    expect((el as any)._logPort).toBe(port);
  });

  it("a newer install supersedes a pending acquisition and reclaims its port", async () => {
    const el = await mount();
    const port = makePort({
      setSignals: vi.fn(async () => {
        (el as any)._bootLogsGen++; // a second flash started
      }),
    });
    openLiveLogPort.mockResolvedValue({ port, error: null });

    await (el as any)._openBootLogs({}, []);

    expect(port.close).toHaveBeenCalledOnce();
    expect((el as any)._logPort).toBeUndefined();
  });

  it("unmounting the receiver aborts the acquisition without a toast", async () => {
    const el = await mount();
    openLiveLogPort.mockImplementation(async (...args: unknown[]) => {
      el.remove(); // disconnectedCallback bumps the generation
      expect((args[4] as () => boolean)()).toBe(true);
      return { port: null };
    });

    await (el as any)._openBootLogs({}, []);

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reopens the kept port through openPortForLogs on the Logs button", async () => {
    const el = await mount();
    const port = makePort();
    (el as any)._flashDone = true;
    (el as any)._logPort = port;

    await (el as any)._onViewLogs();

    expect(openPortForLogs).toHaveBeenCalledWith(port, expect.anything());
    expect((el as any)._logsOpen).toBe(true);
  });
});

describe("esphome-web-flash-receiver keep-visible warning", () => {
  it("shows the warning only while a flash is running", async () => {
    const el = await mount();
    (el as any)._state = "installing";
    (el as any)._statusMessage = "x";
    (el as any)._busy = true;
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain("firmware.flashing_keep_visible");

    (el as any)._busy = false;
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).not.toContain("firmware.flashing_keep_visible");
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
