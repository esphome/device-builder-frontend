/**
 * nRF52 Nordic Legacy DFU install flow, split from install-flow.ts for the
 * line budget. The engine loads on demand so it stays out of the main chunk.
 */
import type { ConfiguredDevice } from "../../api/types/devices.js";
import { getErrorMessage } from "../../util/error-message.js";
import { requestSerialPort } from "../../util/web-serial.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import { compileOrFail, failNoBinaries, fetchBinaries } from "./install-flow.js";

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

  if (!(await compileOrFail(host, device.configuration))) return;

  host._statusMessage = host._localize("firmware.status_downloading");
  const binaries = await fetchBinaries(host, device.configuration);
  if (!binaries) return;
  if (binaries.length === 0) {
    failNoBinaries(host, { isWebFlasher: false, isEmpty: true });
    return;
  }

  const dfuBinary = binaries.find((b) => b.file.endsWith(".zip"));
  if (!dfuBinary) {
    host._fail(host._localize("firmware.nrf_no_dfu_package"));
    return;
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(
      await host._api.firmwareDownloadBytes(device.configuration, dfuBinary.file)
    );
  } catch (err) {
    host._fail(host._localize("firmware.download_failed"), getErrorMessage(err));
    return;
  }

  let parseDfuPackage: Awaited<ReturnType<typeof loadDfuEngine>>["parseDfuPackage"];
  try {
    ({ parseDfuPackage } = await loadDfuEngine());
  } catch (err) {
    host._fail(host._localize("firmware.download_failed"), getErrorMessage(err));
    return;
  }
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
  host._errorMessage = "";
  host._flashPercent = 0;
  host._nrfBusy = false;
  host._step = "nrf-reset";
  host._statusMessage = host._localize("firmware.nrf_step1_title");
}

/** Step 1: 1200-baud touch into DFU mode. Runs from a button click (user gesture). */
export async function nrfDoReset(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const pkg = host._nrfPkg;
  if (!pkg || host._nrfBusy) return;
  // The dialog is reused; only touch it if it still shows this install.
  const device = host._device;
  const stillCurrent = () => host._device === device && host._nrfPkg === pkg;
  host._nrfBusy = true;
  host._statusMessage = host._localize("firmware.nrf_resetting");
  try {
    const port = await requestSerialPort();
    if (!port) {
      if (stillCurrent())
        host._statusMessage = host._localize("firmware.nrf_step1_title");
      return;
    }
    const { resetToBootloader } = await loadDfuEngine();
    await resetToBootloader(port);
  } catch (err) {
    if (stillCurrent()) {
      host._fail(host._localize("firmware.nrf_connect_failed"), getErrorMessage(err));
    }
    return;
  } finally {
    if (stillCurrent()) host._nrfBusy = false;
  }
  if (!stillCurrent()) return;
  host._step = "nrf-wait";
  host._statusMessage = host._localize("firmware.nrf_step2_title");
}

/** Step 2: flash over the re-enumerated DFU port. Runs from a button click. */
export async function nrfDoFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const pkg = host._nrfPkg;
  if (!pkg || host._nrfBusy) return;
  // Teardown aborts the session, but the abort still lands here on a dialog
  // that may already show another install, so only report back to the same
  // one. A retry re-parses, so package identity covers a restart on the same
  // device.
  const device = host._device;
  const stillCurrent = () => host._device === device && host._nrfPkg === pkg;
  host._nrfBusy = true;
  let port: SerialPort | null;
  try {
    port = await requestSerialPort();
  } catch (err) {
    if (stillCurrent()) {
      host._fail(host._localize("firmware.nrf_connect_failed"), getErrorMessage(err));
    }
    return;
  } finally {
    if (stillCurrent()) host._nrfBusy = false;
  }
  if (!port || !stillCurrent()) return;
  host._step = "flashing";
  host._statusMessage = host._localize("firmware.status_flashing");
  host._flashPercent = 0;
  const abort = new AbortController();
  host._nrfAbort = abort;
  try {
    const { flashDfuPackageWithReconnect } = await loadDfuEngine();
    await flashDfuPackageWithReconnect(
      port,
      pkg,
      (percent) => {
        if (stillCurrent()) host._flashPercent = percent;
      },
      {
        signal: abort.signal,
        onReconnecting: () => {
          if (stillCurrent()) {
            host._statusMessage = host._localize("firmware.nrf_reconnecting");
          }
        },
      }
    );
  } catch (err) {
    if (stillCurrent()) {
      host._fail(host._localize("firmware.nrf_flash_failed"), getErrorMessage(err));
    }
    return;
  } finally {
    if (host._nrfAbort === abort) host._nrfAbort = null;
  }
  if (!stillCurrent()) return;
  host._statusMessage = host._localize("firmware.status_done");
  host._step = "done";
}
