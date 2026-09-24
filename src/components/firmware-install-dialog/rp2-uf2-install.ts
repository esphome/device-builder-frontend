/**
 * Raspberry Pi Pico (rp2) install flow, mirroring nrf-dfu-install.ts:
 * compile, download and parse the UF2, then two user-gesture steps. The
 * PICOBOOT engine loads on demand so it stays out of the main chunk.
 */
import type { ConfiguredDevice } from "../../api/types/devices.js";
import { getErrorMessage } from "../../util/error-message.js";
import { resetToBootloader } from "../../util/serial-bootloader-touch.js";
import { parseUf2Image, UF2_FAMILY_RP2040, Uf2FamilyError } from "../../util/uf2.js";
import { requestSerialPort } from "../../util/web-serial.js";
import {
  classifyUsbDevice,
  isUsbAccessDenied,
  isUsbDeviceLost,
  requestPicobootDevice,
} from "../../util/web-usb.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import {
  compileOrFail,
  downloadSelectedBinary,
  failNoBinaries,
  fetchBinaries,
} from "./install-flow.js";

const loadPicoboot = () => import("../../util/rp2-picoboot.js");

/**
 * Compile, download and parse the UF2, then hand off to the BOOTSEL step.
 * Only RP2040 images are flashable here; an RP2350 UF2 is refused up front.
 */
export async function startRp2Uf2Install(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  const device = host._device;
  if (!device) return;
  // The dialog is reused; a close-and-reopen for another device during an
  // await must not receive this install's image.
  const stale = () => host._device !== device;

  if (!(await compileOrFail(host, device.configuration)) || stale()) return;

  host._statusMessage = host._localize("firmware.status_downloading");
  const binaries = await fetchBinaries(host, device.configuration);
  if (!binaries || stale()) return;
  if (binaries.length === 0) {
    failNoBinaries(host, { isWebFlasher: false, isEmpty: true });
    return;
  }

  const uf2 =
    binaries.find((b) => b.type === "uf2") ??
    binaries.find((b) => b.file.endsWith(".uf2"));
  if (!uf2) {
    host._fail(host._localize("firmware.rp2_no_uf2"));
    return;
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(
      await host._api.firmwareDownloadBytes(device.configuration, uf2.file)
    );
  } catch (err) {
    if (!stale())
      host._fail(host._localize("firmware.download_failed"), getErrorMessage(err));
    return;
  }
  if (stale()) return;

  try {
    host._rp2Image = parseUf2Image(bytes, [UF2_FAMILY_RP2040]);
  } catch (err) {
    if (err instanceof Uf2FamilyError) {
      host._fail(host._localize("firmware.rp2_rp2350_unsupported"), err.message);
    } else {
      host._fail(host._localize("firmware.rp2_bad_uf2"), getErrorMessage(err));
    }
    return;
  }
  host._rp2Uf2File = uf2.file;
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
  host._errorMessage = "";
  host._flashPercent = 0;
  host._flashBusy = false;
  host._step = "rp2-bootsel";
  host._statusMessage = host._localize("firmware.rp2_bootsel_title");
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
    await resetToBootloader(port);
  } catch (err) {
    if (stillCurrent()) {
      host._fail(host._localize("firmware.rp2_connect_failed"), getErrorMessage(err));
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
  let dev: Awaited<ReturnType<typeof openPicoboot>>;
  try {
    dev = await openPicoboot(host, stillCurrent);
  } finally {
    if (stillCurrent()) host._flashBusy = false;
  }
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
      host._fail(host._localize("firmware.rp2_connect_failed"), getErrorMessage(err));
    }
    return null;
  }
  if (!usb || !stillCurrent()) return null;
  const kind = classifyUsbDevice(usb);
  if (kind !== "rp2040") {
    host._fail(
      host._localize(
        kind === "rp2350" ? "firmware.rp2_rp2350_unsupported" : "firmware.rp2_not_bootsel"
      )
    );
    return null;
  }
  try {
    const { PicobootDevice } = await loadPicoboot();
    return await PicobootDevice.open(usb);
  } catch (err) {
    if (stillCurrent()) {
      host._fail(
        host._localize(
          isUsbAccessDenied(err)
            ? "firmware.rp2_usb_access_denied"
            : "firmware.rp2_connect_failed"
        ),
        getErrorMessage(err)
      );
    }
    return null;
  }
}

/** Step 2 without WebUSB: save the UF2 for a manual copy onto the RPI-RP2 drive. */
export function rp2DoDownload(host: ESPHomeFirmwareInstallDialog): void {
  if (!host._rp2Uf2File || host._flashBusy) return;
  void downloadSelectedBinary(host, host._rp2Uf2File);
}
