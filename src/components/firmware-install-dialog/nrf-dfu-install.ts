/**
 * nRF52 Nordic Legacy DFU install flow for the firmware-install-dialog.
 * Split from install-flow.ts to keep that file within the line-count budget.
 *
 * Entry point: startNrfDfuInstall() — compiles, downloads, and transitions
 * the dialog to "nrf-reset" so the user can trigger the 1200-baud reset.
 * The two user-gesture callbacks (_nrfDoReset / _nrfDoFlash) live on the
 * dialog class itself; they're called by footer buttons in renderers.ts.
 *
 * The DFU engine (and its zip parser) is loaded on demand: only nRF52 targets
 * ever reach this flow, so it stays out of the main dashboard chunk.
 */
import { getErrorMessage } from "../../util/error-message.js";
import { requestSerialPort } from "../../util/web-serial.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import { compileOrFail, failNoBinaries, fetchBinaries } from "./install-flow.js";

const loadDfuEngine = () => import("../../util/nrf-dfu.js");

/**
 * Compile firmware, download the DFU package, parse it, then advance the
 * dialog to the two-step nRF DFU flash flow:
 *   "nrf-reset" → user triggers 1200-baud reset via _nrfDoReset()
 *   "nrf-wait"  → user connects the DFU port and flashes via _nrfDoFlash()
 *
 * Only the ``firmware.zip`` DFU package ESPHome produces for the Adafruit
 * bootloader can be flashed this way; a build without one (MCUboot / hex
 * only) fails here rather than guessing at a raw image.
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
  } catch {
    host._fail(host._localize("firmware.download_failed"));
    return;
  }

  const { parseDfuPackage } = await loadDfuEngine();
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
 * Step 1: open the port picker, trigger 1200-baud reset to enter DFU mode.
 * Must be called directly from a user-gesture handler for requestPort().
 */
export async function nrfDoReset(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  if (!host._nrfPkg || host._nrfBusy) return;
  host._nrfBusy = true;
  host._statusMessage = host._localize("firmware.nrf_resetting");
  try {
    const port = await requestSerialPort();
    if (!port) {
      host._statusMessage = host._localize("firmware.nrf_step1_title");
      return;
    }
    const { resetToBootloader } = await loadDfuEngine();
    await resetToBootloader(port);
  } catch (err) {
    host._fail(host._localize("firmware.nrf_connect_failed"), getErrorMessage(err));
    return;
  } finally {
    host._nrfBusy = false;
  }
  host._step = "nrf-wait";
  host._statusMessage = host._localize("firmware.nrf_step2_title");
}

/**
 * Step 2: open the DFU port picker and flash the compiled firmware.
 * Must be called directly from a user-gesture handler for requestPort().
 */
export async function nrfDoFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const pkg = host._nrfPkg;
  if (!pkg || host._nrfBusy) return;
  host._nrfBusy = true;
  let port: SerialPort | null;
  try {
    port = await requestSerialPort();
  } catch (err) {
    host._fail(host._localize("firmware.nrf_connect_failed"), getErrorMessage(err));
    return;
  } finally {
    host._nrfBusy = false;
  }
  if (!port) return;
  host._step = "flashing";
  host._statusMessage = host._localize("firmware.status_flashing");
  host._flashPercent = 0;
  // Stop / close doesn't abort the DFU session (there's no job to cancel and
  // the serial write can't be interrupted safely), so the flash runs to
  // completion in the background. The dialog instance is reused: only report
  // back if it still shows this install and hasn't been closed or restarted.
  // A retry re-parses the package, so the package identity distinguishes a
  // restarted install on the same device too.
  const device = host._device;
  const stillCurrent = () => host._device === device && host._nrfPkg === pkg;
  try {
    const { flashDfuPackage } = await loadDfuEngine();
    await flashDfuPackage(port, pkg, (percent) => {
      if (stillCurrent()) host._flashPercent = percent;
    });
  } catch (err) {
    if (stillCurrent()) {
      host._fail(host._localize("firmware.nrf_flash_failed"), getErrorMessage(err));
    }
    return;
  }
  if (!stillCurrent()) return;
  host._statusMessage = host._localize("firmware.status_done");
  host._step = "done";
}
