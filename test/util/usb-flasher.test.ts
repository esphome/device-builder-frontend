// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { openFlasherAndHandOff } from "../../src/util/usb-flasher.js";

const FLASHER_ORIGIN = "https://esphome.github.io";

interface FakeHost {
  _usbFirmware: ArrayBuffer | null;
  _usbFirmwareName: string;
  _localize: (k: string) => string;
  _step: string;
  _flashPercent: number;
  _statusMessage: string;
  _fail: (title: string, detail?: string) => void;
  _usbFlashTeardown: (() => void) | null;
  failDetail?: string;
}

function makeHost(firmware: ArrayBuffer | null = new ArrayBuffer(32)): FakeHost {
  return {
    _usbFirmware: firmware,
    _usbFirmwareName: "firmware.factory.bin",
    _localize: (k) => k,
    _step: "download-ready",
    _flashPercent: 0,
    _statusMessage: "",
    _fail(title, detail) {
      this._step = "error";
      this.failDetail = detail;
    },
    _usbFlashTeardown: null,
  };
}

const asHost = (h: FakeHost) => h as unknown as ESPHomeFirmwareInstallDialog;

function emit(win: unknown, data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: FLASHER_ORIGIN,
      source: win as Window,
    })
  );
}

beforeEach(() => {
  if (!crypto.randomUUID) {
    (crypto as unknown as { randomUUID: () => string }).randomUUID = () => "nonce";
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("openFlasherAndHandOff", () => {
  it("does nothing without firmware in hand", () => {
    const open = vi.spyOn(window, "open");
    openFlasherAndHandOff(asHost(makeHost(null)));
    expect(open).not.toHaveBeenCalled();
  });

  it("fails the dialog when the pop-up is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const host = makeHost();
    openFlasherAndHandOff(asHost(host));
    expect(host._step).toBe("error");
  });

  it("opens with nonce+origin and hands off on ready, mirroring state", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    const open = vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const host = makeHost();
    openFlasherAndHandOff(asHost(host));

    const url = open.mock.calls[0][0] as string;
    expect(url).toContain("#nonce=");
    expect(url).toContain("origin=");
    expect(host._step).toBe("flashing");

    emit(fakeWin, { type: "esphome-web-flash:ready" });
    expect(fakeWin.postMessage).toHaveBeenCalledTimes(1);
    const [msg, targetOrigin, transfer] = fakeWin.postMessage.mock.calls[0];
    expect(msg.type).toBe("esphome-web-flash:firmware");
    expect(msg.parts[0].address).toBe(0);
    expect(targetOrigin).toBe(FLASHER_ORIGIN);
    expect(transfer).toHaveLength(1);
    expect(host._usbFirmware).toBeNull(); // detached after transfer

    emit(fakeWin, { type: "esphome-web-flash:progress", pct: 42 });
    expect(host._flashPercent).toBe(42);

    emit(fakeWin, { type: "esphome-web-flash:state", state: "done" });
    expect(host._step).toBe("done");
  });

  it("exposes a teardown that stops listening (dialog close / reuse)", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const host = makeHost();
    openFlasherAndHandOff(asHost(host));
    expect(host._usbFlashTeardown).toBeTypeOf("function");
    // Simulate _detachStream on dialog close/reuse.
    host._usbFlashTeardown!();
    expect(host._usbFlashTeardown).toBeNull();
    // A late flasher message must no longer be acted on.
    emit(fakeWin, { type: "esphome-web-flash:ready" });
    expect(fakeWin.postMessage).not.toHaveBeenCalled();
  });

  it("surfaces a flasher error state", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const host = makeHost();
    openFlasherAndHandOff(asHost(host));
    emit(fakeWin, { type: "esphome-web-flash:ready" });
    emit(fakeWin, {
      type: "esphome-web-flash:state",
      state: "error",
      detail: "boom",
    });
    expect(host._step).toBe("error");
    expect(host.failDetail).toBe("boom");
  });
});
