/**
 * nRF52 Nordic Legacy DFU install flow, split from install-flow.ts for the
 * line budget. The engine loads on demand so it stays out of the main chunk.
 */
import type { ConfiguredDevice } from "../../api/types/devices.js";
import { getErrorMessage } from "../../util/error-message.js";
import { resetToBootloader } from "../../util/serial-bootloader-touch.js";
import { requestSerialPort } from "../../util/web-serial.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import {
  downloadBuildArtifact,
  installLog,
  pickSerialPortOrFail,
  resetForRetry,
} from "./browser-flash-steps.js";

const loadDfuEngine = () => import("../../util/nrf-dfu.js");

/**
 * Compile, download and parse the DFU package, then hand off to the two
 * user-gesture steps. Only ESPHome's ``firmware.zip`` (Adafruit bootloader
 * build) is flashable; MCUboot / hex builds fail here rather than guessing
 * at a raw image.
 */
export async function startNrfDfuInstall(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  const device = host._device;
  if (!device) return;
  const artifact = await downloadBuildArtifact(
    host,
    device,
    (b) => b.file.endsWith(".zip"),
    "firmware.nrf_no_dfu_package"
  );
  if (!artifact) return;
  const bytes = artifact.bytes;
  const stale = () => host._device !== device;

  let parseDfuPackage: Awaited<ReturnType<typeof loadDfuEngine>>["parseDfuPackage"];
  try {
    ({ parseDfuPackage } = await loadDfuEngine());
  } catch (err) {
    if (!stale())
      host._fail(host._localize("firmware.download_failed"), getErrorMessage(err));
    return;
  }
  if (stale()) return;
  try {
    host._nrfPkg = parseDfuPackage(bytes);
  } catch (err) {
    host._fail(host._localize("firmware.nrf_bad_package"), getErrorMessage(err));
    return;
  }

  host._step = "nrf-reset";
  host._statusMessage = host._localize("firmware.nrf_step1_title");
}

/**
 * Retry after a failed reset or flash (device dropped mid-transfer, wrong
 * port picked). The package is still parsed, so skip the compile and go back
 * to the DFU steps: the port was released on failure and the device is in
 * the bootloader or back in the app, and step 1 handles either.
 */
export function retryNrfDfu(
  host: ESPHomeFirmwareInstallDialog,
  device: ConfiguredDevice
): void {
  if (!host._nrfPkg) {
    host.installNrfDfu(device);
    return;
  }
  resetForRetry(host);
  host._step = "nrf-reset";
  host._statusMessage = host._localize("firmware.nrf_step1_title");
}

/** Step 1: 1200-baud touch into DFU mode. Runs from a button click (user gesture). */
export async function nrfDoReset(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const pkg = host._nrfPkg;
  if (!pkg || host._flashBusy) return;
  // The dialog is reused; only touch it if it still shows this install.
  const device = host._device;
  const stillCurrent = () => host._device === device && host._nrfPkg === pkg;
  host._flashBusy = true;
  host._statusMessage = host._localize("firmware.nrf_resetting");
  // Only a touch that failed earns the manual-bootloader hint; a picker or
  // permission failure has nothing to do with the board.
  let touching = false;
  try {
    const port = await requestSerialPort();
    if (!port) {
      if (stillCurrent())
        host._statusMessage = host._localize("firmware.nrf_step1_title");
      return;
    }
    // The picker outlives a dismissed dialog; don't reset a port picked for
    // an install that no longer exists.
    if (!stillCurrent()) return;
    touching = true;
    await resetToBootloader(port, installLog(host, stillCurrent));
  } catch (err) {
    if (stillCurrent()) {
      host._fail(
        host._localize("firmware.browser_flash_connect_failed"),
        touching ? withManualBootloaderHint(host, err) : getErrorMessage(err)
      );
    }
    return;
  } finally {
    if (stillCurrent()) host._flashBusy = false;
  }
  if (!stillCurrent()) return;
  host._step = "nrf-wait";
  host._statusMessage = host._localize("firmware.nrf_step2_title");
}

/** Step 2: flash over the re-enumerated DFU port. Runs from a button click. */
export async function nrfDoFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const pkg = host._nrfPkg;
  if (!pkg || host._flashBusy) return;
  // Teardown aborts the session, but the abort still lands here on a dialog
  // that may already show another install, so only report back to the same
  // one. A retry re-parses, so package identity covers a restart on the same
  // device.
  const device = host._device;
  const stillCurrent = () => host._device === device && host._nrfPkg === pkg;
  const port = await pickSerialPortOrFail(host, stillCurrent);
  if (!port) return;
  host._step = "flashing";
  host._statusMessage = host._localize("firmware.status_flashing");
  host._flashPercent = 0;
  const abort = new AbortController();
  host._flashAbort = abort;
  try {
    const { flashDfuPackageWithReconnect } = await loadDfuEngine();
    await flashDfuPackageWithReconnect(port, pkg, {
      signal: abort.signal,
      onProgress: (percent) => {
        if (stillCurrent()) host._flashPercent = percent;
      },
      onLog: installLog(host, stillCurrent),
      onReconnecting: () => {
        if (stillCurrent()) {
          host._statusMessage = host._localize("firmware.nrf_reconnecting");
        }
      },
    });
  } catch (err) {
    if (stillCurrent()) {
      host._fail(
        host._localize("firmware.nrf_flash_failed"),
        withManualBootloaderHint(host, err)
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

// A failed touch or a bootloader that never answered both have the same way
// out: enter the bootloader by hand. An abort is the dialog's own teardown.
function withManualBootloaderHint(
  host: ESPHomeFirmwareInstallDialog,
  err: unknown
): string {
  const message = getErrorMessage(err);
  if (err instanceof DOMException && err.name === "AbortError") return message;
  // The joined sentence is one translatable string; a browser message that
  // already ends with a period would otherwise double it.
  return host._localize("firmware.nrf_manual_bootloader_hint", {
    error: message.replace(/\.\s*$/, ""),
  });
}
