// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/web-serial.js", () => ({
  isPortPickerCancel: vi.fn(() => false),
  webSerialAvailability: vi.fn(() => "available"),
}));
vi.mock("../../src/web/platforms/esp/run-flash.js", () => ({ runFlash: vi.fn() }));
vi.mock("../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../src/components/ansi-log.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("../../src/web/logs/esphome-web-logs-dialog.js", () => ({}));
vi.mock("../../src/web/logs/open-port-for-logs.js", () => ({
  openPortForLogs: vi.fn(async () => true),
}));

const openLiveLogPort = vi.fn();
vi.mock("../../src/web/flash-receiver/live-log-port.js", () => ({
  openLiveLogPort: (...args: unknown[]) => openLiveLogPort(...args),
}));

import toast from "sonner-js";

import { ESP_SERIAL_LOGS } from "../../src/platforms/esp/serial-logs.js";
import { acquireBootLogs } from "../../src/web/flash-receiver/boot-logs.js";
import { ESPHomeWebFlashReceiver } from "../../src/web/flash-receiver/esphome-web-flash-receiver.js";
import { openPortForLogs } from "../../src/web/logs/open-port-for-logs.js";
import { makeWebSerialPort as makePort } from "./_make-web-serial-port.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function mount(): Promise<ESPHomeWebFlashReceiver> {
  const el = new ESPHomeWebFlashReceiver();
  (el as any)._localize = (k: string) => k;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("esphome-web-flash-receiver boot logs hand-off", () => {
  it.each([
    { carried: 9600, opened: 9600 },
    { carried: undefined, opened: 115200 },
  ])("opens the boot logs at $opened for a hand-off baud of $carried", async (c) => {
    const el = await mount();
    if (c.carried) (el as any)._logBaudRate = c.carried;
    openLiveLogPort.mockResolvedValue({ port: makePort(), error: null });

    await acquireBootLogs(el as any, {} as SerialPort, []);

    expect(openLiveLogPort.mock.calls[0][2]).toBe(c.opened);
  });

  it("keeps the hand-off's baud for the Logs button", async () => {
    const el = await mount();
    const port = makePort();
    (el as any)._logBaudRate = 9600;
    (el as any)._logPort = port;

    await (el as any)._onViewLogs();

    expect(vi.mocked(openPortForLogs).mock.calls[0][3]).toBe(9600);
  });

  it("opens the logs dialog immediately and hands it the acquired port", async () => {
    const el = await mount();
    const port = makePort();
    openLiveLogPort.mockImplementation(async () => {
      // The dialog must already be open while the device re-enumerates.
      expect((el as any)._logsOpen).toBe(true);
      return { port, error: null };
    });

    await acquireBootLogs(el as any, {} as SerialPort, []);

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
    const port = makePort();
    openLiveLogPort.mockImplementation(async (...args: unknown[]) => {
      (el as any)._logsOpen = false; // user closed the dialog mid-wait
      expect((args[4] as () => boolean)()).toBe(false); // acquisition continues
      return { port, error: null };
    });

    await acquireBootLogs(el as any, {} as SerialPort, []);

    expect(port.close).toHaveBeenCalledOnce();
    expect((el as any)._logPort).toBe(port);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts and closes the dialog when the device never re-enumerates", async () => {
    const el = await mount();
    openLiveLogPort.mockResolvedValue({ port: null, error: "gone" });

    await acquireBootLogs(el as any, {} as SerialPort, []);

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

    await acquireBootLogs(el as any, {} as SerialPort, []);

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

    await acquireBootLogs(el as any, {} as SerialPort, []);

    expect(port.close).toHaveBeenCalledOnce();
    expect((el as any)._logPort).toBeUndefined();
  });

  it("toasts, closes and parks a handle whose stream died during the hand-off", async () => {
    const el = await mount();
    const port = makePort();
    (port as any).setSignals = vi.fn(async () => {
      (port as any).readable = null; // device yanked mid-hand-off
    });
    openLiveLogPort.mockResolvedValue({ port, error: null });

    await acquireBootLogs(el as any, {} as SerialPort, []);

    expect(port.close).toHaveBeenCalledOnce();
    // Parked: openPortForLogs can often reopen a UA-closed handle, so the
    // Logs button stays a recovery path instead of forcing a re-flash.
    expect((el as any)._logPort).toBe(port);
    expect((el as any)._logsOpen).toBe(false);
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("releases a parked handle on unmount", async () => {
    const el = await mount();
    const port = makePort();
    (el as any)._logPort = port;

    el.remove();

    expect(port.close).toHaveBeenCalledOnce();
  });

  it("unmounting the receiver aborts the acquisition without a toast", async () => {
    const el = await mount();
    openLiveLogPort.mockImplementation(async (...args: unknown[]) => {
      el.remove(); // disconnectedCallback bumps the generation
      expect((args[4] as () => boolean)()).toBe(true);
      return { port: null };
    });

    await acquireBootLogs(el as any, {} as SerialPort, []);

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reopens the kept port through openPortForLogs on the Logs button", async () => {
    const el = await mount();
    const port = makePort();
    (el as any)._flashDone = true;
    (el as any)._logPort = port;

    await (el as any)._onViewLogs();

    expect(openPortForLogs).toHaveBeenCalledWith(
      port,
      expect.anything(),
      ESP_SERIAL_LOGS,
      115200
    );
    expect((el as any)._logsOpen).toBe(true);
  });

  it("a flash starting during the Logs reopen closes the orphaned handle", async () => {
    const el = await mount();
    const port = makePort();
    (el as any)._logPort = port;
    vi.mocked(openPortForLogs).mockImplementation(async () => {
      (el as any)._bootLogsGen++; // _runInstall ran during the reopen
      (el as any)._logPort = undefined;
      return true;
    });

    await (el as any)._onViewLogs();

    expect(port.close).toHaveBeenCalledOnce();
    expect((el as any)._logsOpen).toBe(false);
  });
});

describe("esphome-web-flash-receiver reset note in the boot logs", () => {
  it("leaves the note off the logs of a board that rebooted itself", async () => {
    const el = await mount();
    const port = makePort();
    openLiveLogPort.mockResolvedValue({ port, error: null });
    (el as any)._engine = async () => ({
      note: { message: "Release PA00" },
      logs: { port, knownPorts: [], rebooted: true },
    });
    await (el as any)._runInstall(vi.fn());
    expect((el as any)._logsNotice).toBe("");
  });

  it("heads the logs with the reset left to the user, and drops it with the dialog", async () => {
    const el = await mount();
    const port = makePort();
    openLiveLogPort.mockResolvedValue({ port, error: null });
    (el as any)._engine = async () => ({
      note: { message: "Installation complete" },
      logs: { port, knownPorts: [], rebooted: false, notice: "Reset the board" },
    });
    await (el as any)._runInstall(vi.fn());
    expect((el as any)._logsNotice).toBe("Reset the board");
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("esphome-web-logs-dialog") as any;
    expect(dialog.notice).toBe("Reset the board");
    dialog.dispatchEvent(new CustomEvent("after-hide"));
    expect((el as any)._logsNotice).toBe("");
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
