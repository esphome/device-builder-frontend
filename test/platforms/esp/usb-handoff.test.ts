// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openFlasher } = vi.hoisted(() => ({ openFlasher: vi.fn() }));
vi.mock("../../../src/platforms/esp/usb-flasher.js", () => ({ openFlasher }));
const rtl = vi.hoisted(() => ({ loadAmbz2Image: vi.fn() }));
vi.mock("../../../src/platforms/rtl87xx/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAmbz2Image: rtl.loadAmbz2Image,
}));
const steps = vi.hoisted(() => ({
  downloadBuildArtifact: vi.fn(),
  pickUf2: (binaries: Array<{ type?: string }>) => binaries.find((b) => b.type === "uf2"),
}));
vi.mock(
  "../../../src/components/firmware-install-dialog/browser-flash-steps.js",
  () => steps
);

import { identityLocalize } from "../../_dom.js";
import { makeUf2Block } from "../../_make-uf2-block.js";
import { FLASHER_HOST } from "../../../src/common/docs.js";
import { defaultLocalize } from "../../../src/common/localize.js";
import type { ESPHomeFirmwareInstallDialog } from "../../../src/components/firmware-install-dialog.js";
import { cardStatusDetail } from "../../../src/components/firmware-install-dialog/renderers.js";
import type { FlasherCallbacks } from "../../../src/platforms/esp/usb-flasher.js";
import {
  handOffToFlasher,
  startUsbFlash,
} from "../../../src/platforms/esp/usb-handoff.js";
import { UF2_FAMILY_RP2350_ARM_S } from "../../../src/util/uf2.js";

function makeHost() {
  const host = {
    _failureKind: null as string | null,
    _usbFirmware: new ArrayBuffer(16) as ArrayBuffer | null,
    _usbFirmwareName: "firmware.factory.bin",
    _device: {
      name: "dev",
      friendly_name: "Dev",
      target_platform: "esp32",
      mcu: null as string | null,
    },
    _step: "download-ready",
    _statusMessage: "",
    _errorMessage: "",
    _flashPercent: 0,
    _usbFlashTeardown: null as (() => void) | null,
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

beforeEach(() => {
  rtl.loadAmbz2Image.mockResolvedValue({ image: { runs: [], totalBytes: 0 } });
});
afterEach(() => vi.clearAllMocks());

// The callbacks the dialog gave the (mocked) flasher session.
const callbacks = () => openFlasher.mock.calls[0][4] as FlasherCallbacks;

describe("handOffToFlasher", () => {
  it("opens nothing for a device whose platform cannot hand off", () => {
    const host = makeHost();
    host._device.target_platform = "nrf52";
    handOffToFlasher(asHost(host));
    expect(openFlasher).not.toHaveBeenCalled();
    expect(host._step).toBe("download-ready");
  });

  it("shows the receiver's done note, and the plain done line without one", () => {
    const host = makeHost();
    handOffToFlasher(asHost(host));
    expect(openFlasher.mock.calls[0][3]).toMatchObject({ flasher: "esp", erase: true });
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

  it("hands a Pico's UF2 to the PICOBOOT flasher, without erase", () => {
    const host = makeHost();
    host._device.target_platform = "rp2040";
    host._device.mcu = "rp2040";
    handOffToFlasher(asHost(host));
    expect(openFlasher.mock.calls[0][3]).toMatchObject({
      flasher: "rp2-picoboot",
      erase: false,
    });
  });

  it("reads the flasher from the device's platform, and names an outdated receiver", () => {
    const host = makeHost();
    host._device.target_platform = "rtl87xx";
    host._device.mcu = "rtl8720c";
    handOffToFlasher(asHost(host));
    expect(openFlasher.mock.calls[0][3]).toMatchObject({
      flasher: "rtl-ambz2",
      erase: false,
    });
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
  function flowHost(targetPlatform: string, mcu: string | null = null) {
    return {
      ...makeHost(),
      _step: "compiling",
      _device: {
        configuration: "d.yaml",
        name: "dev",
        friendly_name: "Dev",
        target_platform: targetPlatform,
        mcu,
      },
      _usbFirmware: null as ArrayBuffer | null,
      _usbFirmwareName: "",
    };
  }
  const binaries = [
    { file: "firmware.factory.bin", title: "Factory" },
    { file: "firmware.uf2", type: "uf2", title: "UF2" },
  ];
  const downloaded = (file: string) => ({
    binary: { file, title: file },
    bytes: new Uint8Array(new ArrayBuffer(4)),
  });

  it("sends the UF2 for an RTL8720C through the shared download", async () => {
    const host = flowHost("rtl87xx", "rtl8720c");
    const artifact = downloaded("firmware.uf2");
    steps.downloadBuildArtifact.mockResolvedValue(artifact);
    await startUsbFlash(asHost(host));
    const [, , pick, noArtifactKey] = steps.downloadBuildArtifact.mock.calls[0];
    expect(pick(binaries)?.file).toBe("firmware.uf2");
    expect(noArtifactKey).toBe("firmware.no_uf2");
    expect(host._usbFirmware).toBe(artifact.bytes.buffer);
    expect(host._usbFirmwareName).toBe("firmware.uf2");
    expect(host._step).toBe("download-ready");
  });

  it("refuses an RTL8710B image in the dashboard, before any flasher tab is offered", async () => {
    const host = flowHost("rtl87xx", "rtl8720c");
    steps.downloadBuildArtifact.mockResolvedValue(downloaded("firmware.uf2"));
    rtl.loadAmbz2Image.mockResolvedValueOnce({
      key: "firmware.rtl_wrong_family",
      detail: "family 0x22e0d6fc",
    });
    await startUsbFlash(asHost(host));
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.rtl_wrong_family");
    expect(host._errorMessage).toBe("family 0x22e0d6fc");
    expect(host._usbFirmware).toBeNull();
  });

  it("sends the UF2 for a Pico through the shared download", async () => {
    const host = flowHost("rp2040", "rp2040");
    const bytes = makeUf2Block({ addr: 0x10000000 });
    steps.downloadBuildArtifact.mockResolvedValue({
      binary: { file: "firmware.uf2", title: "UF2" },
      bytes,
    });
    await startUsbFlash(asHost(host));
    const [, , pick, noArtifactKey] = steps.downloadBuildArtifact.mock.calls[0];
    expect(pick(binaries)?.file).toBe("firmware.uf2");
    expect(noArtifactKey).toBe("firmware.no_uf2");
    expect(host._usbFirmware).toBe(bytes.buffer);
    expect(host._step).toBe("download-ready");
  });

  it("refuses an RP2350 image in the dashboard, before any flasher tab is offered", async () => {
    const host = flowHost("rp2040", "rp2040");
    steps.downloadBuildArtifact.mockResolvedValue({
      binary: { file: "firmware.uf2", title: "UF2" },
      bytes: makeUf2Block({ addr: 0x10000000, family: UF2_FAMILY_RP2350_ARM_S }),
    });
    await startUsbFlash(asHost(host));
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.rp2_rp2350_unsupported");
    expect(host._usbFirmware).toBeNull();
  });

  it("sends the factory image for an ESP through the same download", async () => {
    const host = flowHost("esp32");
    steps.downloadBuildArtifact.mockResolvedValue(downloaded("firmware.factory.bin"));
    await startUsbFlash(asHost(host));
    const [, , pick, noArtifactKey] = steps.downloadBuildArtifact.mock.calls[0];
    expect(pick(binaries)?.file).toBe("firmware.factory.bin");
    expect(noArtifactKey).toBe("firmware.no_flashable_binary");
    expect(host._step).toBe("download-ready");
  });

  it.each([
    ["rtl87xx", "rtl8710b"],
    ["rtl87xx", null],
    ["rp2040", "rp2350"],
    ["rp2040", null],
  ])("refuses %s with chip %s before the build", async (platform, mcu) => {
    const host = flowHost(platform, mcu);
    await startUsbFlash(asHost(host));
    expect(steps.downloadBuildArtifact).not.toHaveBeenCalled();
    expect(host._statusMessage).toBe("firmware.no_flashable_binary");
  });

  it("refuses a platform that has no hand-off instead of sending an ESP image", async () => {
    const host = flowHost("nrf52", "nrf52840");
    await startUsbFlash(asHost(host));
    expect(steps.downloadBuildArtifact).not.toHaveBeenCalled();
    expect(host._statusMessage).toBe("firmware.no_flashable_binary");
  });

  it("stays where the shared download left the dialog when it failed", async () => {
    const host = flowHost("rtl87xx", "rtl8720c");
    steps.downloadBuildArtifact.mockResolvedValue(null);
    await startUsbFlash(asHost(host));
    expect(host._usbFirmware).toBeNull();
    expect(host._step).toBe("compiling");
  });
});
