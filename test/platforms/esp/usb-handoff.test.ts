// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const { openFlasher } = vi.hoisted(() => ({ openFlasher: vi.fn() }));
vi.mock("../../../src/platforms/esp/usb-flasher.js", () => ({ openFlasher }));
const flow = vi.hoisted(() => ({
  compileOrFail: vi.fn(async () => true),
  fetchBinaries: vi.fn(),
  failNoBinaries: vi.fn(),
}));
vi.mock("../../../src/components/firmware-install-dialog/install-flow.js", () => flow);
const steps = vi.hoisted(() => ({ downloadBuildArtifact: vi.fn() }));
vi.mock(
  "../../../src/components/firmware-install-dialog/browser-flash-steps.js",
  () => steps
);

import { identityLocalize } from "../../_dom.js";
import { FLASHER_HOST } from "../../../src/common/docs.js";
import { defaultLocalize } from "../../../src/common/localize.js";
import type { ESPHomeFirmwareInstallDialog } from "../../../src/components/firmware-install-dialog.js";
import { cardStatusDetail } from "../../../src/components/firmware-install-dialog/renderers.js";
import type { FlasherCallbacks } from "../../../src/platforms/esp/usb-flasher.js";
import {
  handOffToFlasher,
  startUsbFlash,
} from "../../../src/platforms/esp/usb-handoff.js";
import { rtlAmbz2Install } from "../../../src/platforms/rtl87xx/ambz2-install.js";

function makeHost() {
  const host = {
    _failureKind: null as string | null,
    _usbFirmware: new ArrayBuffer(16) as ArrayBuffer | null,
    _usbFirmwareName: "firmware.factory.bin",
    _device: { name: "dev", friendly_name: "Dev" },
    _step: "download-ready",
    _statusMessage: "",
    _errorMessage: "",
    _flashPercent: 0,
    _usbFlashTeardown: null as (() => void) | null,
    _usbHandoff: null as unknown,
    _localize: identityLocalize,
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

// The callbacks the dialog gave the (mocked) flasher session.
const callbacks = () => openFlasher.mock.calls[0][4] as FlasherCallbacks;

describe("handOffToFlasher", () => {
  it("shows the receiver's done note, and the plain done line without one", () => {
    const host = makeHost();
    handOffToFlasher(asHost(host));
    expect(openFlasher.mock.calls[0][3]).toBe("esp");
    callbacks().onState("done", "");
    expect(host._statusMessage).toBe("firmware.usb_done");
    callbacks().onState("done", "reset the board");
    expect(host._step).toBe("done");
    expect(host._statusMessage).toBe("reset the board");
  });

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
    const host = makeHost();
    handOffToFlasher(asHost(host));
    // The flasher reports a non-terminal error, then the user retries in-tab and
    // the first frame back is progress (no status detail).
    callbacks().onState("error", "boom");
    expect(host._step).toBe("error");
    expect(host._errorMessage).toBe("boom");
    callbacks().onProgress(10);
    expect(host._step).toBe("flashing");
    expect(host._errorMessage).toBe("");
    expect(host._statusMessage).toBe("firmware.usb_flashing");
    expect(host._flashPercent).toBe(10);
  });

  it("passes the platform flasher's id through, and names an outdated receiver", () => {
    const host = makeHost();
    host._usbHandoff = rtlAmbz2Install;
    handOffToFlasher(asHost(host));
    expect(openFlasher.mock.calls[0][3]).toBe("rtl-ambz2");
    callbacks().onUnsupported("flasher");
    expect(host._errorMessage).toBe("firmware.usb_flasher_outdated");
    expect(host._failureKind).toBe("unsupported-browser");
  });

  it("fails with the unsupported-browser message when the hand-off is declined", () => {
    const host = makeHost();
    handOffToFlasher(asHost(host));
    callbacks().onUnsupported("web-serial");
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.usb_failed");
    expect(host._errorMessage).toBe("firmware.usb_unsupported_browser");
    // Suppresses the Retry footer: retrying recompiles into the same decline.
    expect(host._failureKind).toBe("unsupported-browser");
    // Terminal: the session already tore itself down.
    expect(host._usbFlashTeardown).toBeNull();
  });
});

describe("download-ready detail (web-flash)", () => {
  const detailHost = (errorMessage: string) =>
    ({
      _step: "download-ready",
      _installer: "web-flash",
      _errorMessage: errorMessage,
      _downloadedFilename: "",
      _localize: defaultLocalize,
    }) as unknown as ESPHomeFirmwareInstallDialog;

  it("surfaces the pop-up-blocked message when _errorMessage is set", () => {
    const message = defaultLocalize("firmware.usb_popup_blocked");
    expect(cardStatusDetail(detailHost(message))).toBe(message);
  });

  it("falls back to the built-firmware body when there's no error", () => {
    expect(cardStatusDetail(detailHost(""))).toBe(
      defaultLocalize("firmware.usb_built_body", { host: FLASHER_HOST })
    );
  });
});

describe("startUsbFlash artifact", () => {
  function flowHost(binaries: Array<{ file: string; type?: string; title: string }>) {
    flow.fetchBinaries.mockResolvedValue(binaries);
    const host = {
      ...makeHost(),
      _device: {
        configuration: "d.yaml",
        name: "dev",
        friendly_name: "Dev",
        target_platform: "rtl87xx",
      },
      _usbFirmware: null as ArrayBuffer | null,
      _usbFirmwareName: "",
      _api: { firmwareDownloadBytes: vi.fn(async () => new ArrayBuffer(4)) },
    };
    return host;
  }

  it("sends the platform flasher's own artifact through the shared download, the UF2 for the RTL8720C", async () => {
    const host = flowHost([]);
    host._usbHandoff = rtlAmbz2Install;
    const bytes = new Uint8Array(new ArrayBuffer(4));
    steps.downloadBuildArtifact.mockResolvedValue({
      binary: { file: "firmware.uf2", type: "uf2", title: "UF2" },
      bytes,
    });
    await startUsbFlash(asHost(host));
    const [, , pick, noArtifactKey] = steps.downloadBuildArtifact.mock.calls[0];
    expect(pick({ file: "firmware.uf2", type: "uf2" })).toBe(true);
    expect(pick({ file: "firmware.factory.bin" })).toBe(false);
    expect(noArtifactKey).toBe("firmware.no_uf2");
    expect(host._usbFirmware).toBe(bytes.buffer);
    expect(host._usbFirmwareName).toBe("firmware.uf2");
    expect(host._step).toBe("download-ready");
    expect(flow.compileOrFail).not.toHaveBeenCalled();
  });

  it("stays where the shared download left the dialog when it failed", async () => {
    const host = flowHost([]);
    host._usbHandoff = rtlAmbz2Install;
    steps.downloadBuildArtifact.mockResolvedValue(null);
    host._step = "error";
    await startUsbFlash(asHost(host));
    expect(host._usbFirmware).toBeNull();
    expect(host._step).toBe("error");
  });

  it("still picks the ESP factory image without a platform flasher", async () => {
    const host = flowHost([{ file: "firmware.factory.bin", title: "Factory" }]);
    host._device.target_platform = "esp32";
    await startUsbFlash(asHost(host));
    expect(host._api.firmwareDownloadBytes).toHaveBeenCalledWith(
      "d.yaml",
      "firmware.factory.bin"
    );
  });
});
