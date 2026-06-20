// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const { openFlasher } = vi.hoisted(() => ({ openFlasher: vi.fn() }));
vi.mock("../../src/util/usb-flasher.js", () => ({ openFlasher }));

import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { handOffToFlasher } from "../../src/components/firmware-install-dialog/install-flow.js";
import type { FlasherCallbacks } from "../../src/util/usb-flasher.js";

function makeHost() {
  const host = {
    _usbFirmware: new ArrayBuffer(16) as ArrayBuffer | null,
    _usbFirmwareName: "firmware.factory.bin",
    _device: { name: "dev", friendly_name: "Dev" },
    _step: "download-ready",
    _statusMessage: "",
    _errorMessage: "",
    _flashPercent: 0,
    _usbFlashTeardown: null as (() => void) | null,
    _localize: (k: string) => k,
    _fail(title: string, detail = "") {
      this._step = "error";
      this._statusMessage = title;
      this._errorMessage = detail;
    },
  };
  return host;
}

const asHost = (h: ReturnType<typeof makeHost>) =>
  h as unknown as ESPHomeFirmwareInstallDialog;

afterEach(() => vi.clearAllMocks());

describe("handOffToFlasher", () => {
  it("parks on download-ready and keeps the firmware when the pop-up is blocked", () => {
    openFlasher.mockReturnValue(null);
    const host = makeHost();
    handOffToFlasher(asHost(host));
    expect(host._step).toBe("download-ready");
    expect(host._errorMessage).toBe("firmware.usb_popup_blocked");
    // Still in hand so the user can allow pop-ups and click Open again.
    expect(host._usbFirmware).not.toBeNull();
  });

  it("clears the failure banner when an in-tab retry resumes flashing", () => {
    let cbs: FlasherCallbacks | undefined;
    openFlasher.mockImplementation(
      (_fw: ArrayBuffer, _n: string, _d: string, callbacks: FlasherCallbacks) => {
        cbs = callbacks;
        return () => {};
      }
    );
    const host = makeHost();
    handOffToFlasher(asHost(host));
    // The flasher reports a non-terminal error, then the user retries in-tab and
    // the first frame back is progress (no status detail).
    cbs!.onState("error", "boom");
    expect(host._step).toBe("error");
    expect(host._errorMessage).toBe("boom");
    cbs!.onProgress(10);
    expect(host._step).toBe("flashing");
    expect(host._errorMessage).toBe("");
    expect(host._statusMessage).toBe("firmware.usb_flashing");
    expect(host._flashPercent).toBe(10);
  });
});
