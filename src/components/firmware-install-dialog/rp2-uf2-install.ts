/**
 * Raspberry Pi Pico (rp2) install flow, mirroring nrf-dfu-install.ts:
 * compile, download and parse the UF2, then two user-gesture steps. The
 * PICOBOOT engine loads on demand so it stays out of the main chunk.
 */
import type { ConfiguredDevice } from "../../api/types/devices.js";
import { getErrorMessage } from "../../util/error-message.js";
import { resetToBootloader } from "../../util/serial-bootloader-touch.js";
import {
  parseUf2Image,
  UF2_FAMILY_RP2040,
  UF2_FAMILY_RP2350_ARM_S,
  Uf2FamilyError,
} from "../../util/uf2.js";
import { requestSerialPort } from "../../util/web-serial.js";
import {
  classifyUsbDevice,
  isUsbAccessDenied,
  isUsbDeviceLost,
  loadPicoboot,
  requestPicobootDevice,
} from "../../util/web-usb.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import { downloadBuildArtifact, resetForRetry } from "./browser-flash-steps.js";
import { downloadSelectedBinary } from "./install-flow.js";

/**
 * Compile, download and parse the UF2, then hand off to the BOOTSEL step.
 * Only RP2040 images are flashable here; an RP2350 UF2 is refused up front.
 */
export async function startRp2Uf2Install(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  const device = host._device;
  if (!device) return;
  const artifact = await downloadBuildArtifact(
    host,
    device,
    (b) => b.type === "uf2",
    "firmware.no_uf2"
  );
  if (!artifact) return;
  try {
    host._rp2Image = parseUf2Image(artifact.bytes, [UF2_FAMILY_RP2040]);
  } catch (err) {
    // Only a real RP2350 image gets the copy-to-drive advice; a missing or
    // unknown family is just a bad file.
    const rp2350 =
      err instanceof Uf2FamilyError && err.familyId === UF2_FAMILY_RP2350_ARM_S;
    host._fail(
      host._localize(rp2350 ? "firmware.rp2_rp2350_unsupported" : "firmware.rp2_bad_uf2"),
      getErrorMessage(err)
    );
    return;
  }
  // The only artifact this flow hands out; the download step reads it from here.
  host._binaries = [artifact.binary];
  showBootselStep(host);
}

function showBootselStep(host: ESPHomeFirmwareInstallDialog): void {
  host._step = "rp2-bootsel";
  host._statusMessage = host._localize("firmware.rp2_bootsel_title");
}

/** Retry after a failed reset or flash: the image is still parsed, so skip the compile. */
export function retryRp2Uf2(
  host: ESPHomeFirmwareInstallDialog,
  device: ConfiguredDevice
): void {
  if (!host._rp2Image) {
    host.installRp2Uf2(device);
    return;
  }
  resetForRetry(host);
  showBootselStep(host);
}

/** Step 1: 1200-baud touch into BOOTSEL. Runs from a button click (user gesture). */
export async function rp2DoReset(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const image = host._rp2Image;
  if (!image || host._flashBusy) return;
  const device = host._device;
  const stillCurrent = () => host._device === device && host._rp2Image === image;
  host._flashBusy = true;
  host._statusMessage = host._localize("firmware.rp2_resetting");
  try {
    const port = await requestSerialPort();
    if (!port) {
      if (stillCurrent())
        host._statusMessage = host._localize("firmware.rp2_bootsel_title");
      return;
    }
    // The picker outlives a dismissed dialog; don't reset a port picked for
    // an install that no longer exists.
    if (!stillCurrent()) return;
    await resetToBootloader(port);
  } catch (err) {
    if (stillCurrent()) {
      host._fail(
        host._localize("firmware.browser_flash_connect_failed"),
        getErrorMessage(err)
      );
    }
    return;
  } finally {
    if (stillCurrent()) host._flashBusy = false;
  }
  if (!stillCurrent()) return;
  host._step = "rp2-wait";
  host._statusMessage = host._localize("firmware.rp2_wait_title");
}

/** Step 2 with WebUSB: pick the RP2 Boot device and write over PICOBOOT. */
export async function rp2DoFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const image = host._rp2Image;
  if (!image || host._flashBusy) return;
  const device = host._device;
  const stillCurrent = () => host._device === device && host._rp2Image === image;
  host._flashBusy = true;
  const dev = await openPicoboot(host, stillCurrent);
  if (stillCurrent()) host._flashBusy = false;
  if (!dev || !stillCurrent()) return;

  host._step = "flashing";
  host._statusMessage = host._localize("firmware.status_flashing");
  host._flashPercent = 0;
  const abort = new AbortController();
  host._flashAbort = abort;
  try {
    const { flashUf2 } = await loadPicoboot();
    await flashUf2(
      dev,
      image,
      (percent) => {
        if (stillCurrent()) host._flashPercent = percent;
      },
      { signal: abort.signal }
    );
  } catch (err) {
    if (stillCurrent()) {
      host._fail(
        host._localize("firmware.rp2_flash_failed"),
        isUsbDeviceLost(err)
          ? host._localize("firmware.rp2_device_lost")
          : getErrorMessage(err)
      );
    }
    return;
  } finally {
    if (host._flashAbort === abort) host._flashAbort = null;
  }
  if (!stillCurrent()) return;
  host._statusMessage = host._localize("firmware.status_done");
  host._step = "done";
}

// Chooser, device classification and PICOBOOT open; null means "nothing to
// flash" (chooser dismissed, or the failure already reported on the host).
async function openPicoboot(
  host: ESPHomeFirmwareInstallDialog,
  stillCurrent: () => boolean
) {
  let usb: USBDevice | null;
  try {
    usb = await requestPicobootDevice();
  } catch (err) {
    if (stillCurrent()) {
      host._fail(
        host._localize("firmware.browser_flash_connect_failed"),
        getErrorMessage(err)
      );
    }
    return null;
  }
  if (!usb || !stillCurrent()) return null;
  // The image was validated as RP2040 already, so an RP2350 here is the
  // wrong board for this build, not an unsupported image.
  const kind = classifyUsbDevice(usb);
  if (kind !== "rp2040") {
    host._fail(
      host._localize(
        kind === "rp2350" ? "firmware.rp2_rp2350_device" : "firmware.rp2_not_bootsel"
      )
    );
    return null;
  }
  try {
    const { PicobootDevice } = await loadPicoboot();
    const dev = await PicobootDevice.open(usb);
    if (stillCurrent()) return dev;
    // The dialog moved on mid-open; release the claim so the next attempt can open it.
    await dev.close();
    return null;
  } catch (err) {
    if (stillCurrent()) {
      host._fail(
        host._localize(
          isUsbAccessDenied(err)
            ? "firmware.rp2_usb_access_denied"
            : "firmware.browser_flash_connect_failed"
        ),
        getErrorMessage(err)
      );
    }
    return null;
  }
}

/** Step 2 without WebUSB: save the UF2 for a manual copy onto the RPI-RP2 drive. */
export function rp2DoDownload(host: ESPHomeFirmwareInstallDialog): void {
  const file = host._binaries[0]?.file;
  if (!file || host._flashBusy) return;
  void downloadSelectedBinary(host, file);
}
