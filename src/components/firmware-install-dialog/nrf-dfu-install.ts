/**
 * nRF52 Nordic Legacy DFU install flow for the firmware-install-dialog.
 * Split from install-flow.ts to keep that file within the line-count budget.
 *
 * Entry point: startNrfDfuInstall() — compiles, downloads, and transitions
 * the dialog to "nrf-reset" so the user can trigger the 1200-baud reset.
 * The two user-gesture callbacks (_nrfDoReset / _nrfDoFlash) live on the
 * dialog class itself; they're called by footer buttons in renderers.ts.
 */
import {
  type DfuPackage,
  flashDfuPackage,
  makeDfuPackageFromBin,
  parseDfuPackage,
  resetToBootloader,
} from "../../util/nrf-dfu.js";
import { isPortPickerCancel } from "../../util/web-serial.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import { compileOrFail, failNoBinaries, fetchBinaries } from "./install-flow.js";

/**
 * Compile firmware, download the binary, parse it as a DFU package, then
 * advance the dialog to the two-step nRF DFU flash flow:
 *   "nrf-reset" → user triggers 1200-baud reset via _nrfDoReset()
 *   "nrf-wait"  → user connects the DFU port and flashes via _nrfDoFlash()
 *
 * Prefers a .zip DFU package from the build artifacts; falls back to a
 * plain .bin and synthesises a minimal init packet.
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

  const dfuBinary =
    binaries.find((b) => b.type === "dfu" || b.file.endsWith(".zip")) ??
    binaries.find((b) => b.file.endsWith(".bin")) ??
    binaries[0];

  let dfuPkg: DfuPackage;
  try {
    const bytes = new Uint8Array(
      await host._api.firmwareDownloadBytes(device.configuration, dfuBinary.file)
    );
    dfuPkg =
      dfuBinary.file.endsWith(".zip") || dfuBinary.type === "dfu"
        ? parseDfuPackage(bytes)
        : makeDfuPackageFromBin(bytes);
  } catch {
    host._fail(host._localize("firmware.download_failed"));
    return;
  }

  host._nrfPkg = dfuPkg;
  host._step = "nrf-reset";
  host._statusMessage = host._localize("firmware.nrf_step1_title");
}

/**
 * Step 1: open the port picker, trigger 1200-baud reset to enter DFU mode.
 * Must be called directly from a user-gesture handler for requestPort().
 */
export async function nrfDoReset(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  if (!host._nrfPkg) return;
  host._statusMessage = host._localize("firmware.nrf_resetting");
  let port: SerialPort;
  try {
    port = await navigator.serial.requestPort();
  } catch (err) {
    if (isPortPickerCancel(err)) {
      host._statusMessage = host._localize("firmware.nrf_step1_title");
      return;
    }
    host._fail(host._localize("firmware.nrf_connect_failed"));
    return;
  }
  try {
    await resetToBootloader(port);
  } catch (err) {
    host._fail(
      host._localize("firmware.nrf_connect_failed"),
      err instanceof Error ? err.message : String(err)
    );
    return;
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
  if (!pkg) return;
  let port: SerialPort;
  try {
    port = await navigator.serial.requestPort();
  } catch (err) {
    if (isPortPickerCancel(err)) return;
    host._fail(host._localize("firmware.nrf_connect_failed"));
    return;
  }
  host._step = "flashing";
  host._statusMessage = host._localize("firmware.status_flashing");
  host._flashPercent = 0;
  try {
    await flashDfuPackage(port, pkg, (p) => {
      host._flashPercent = p.percent;
    });
  } catch (err) {
    host._fail(
      host._localize("firmware.nrf_flash_failed"),
      err instanceof Error ? err.message : String(err)
    );
    return;
  }
  host._statusMessage = host._localize("firmware.status_done");
  host._step = "done";
}
