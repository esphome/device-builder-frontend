/**
 * The Device Builder's nRF52 install: Nordic legacy DFU over the bootloader's
 * CDC. The engine loads on demand so it stays out of the main chunk.
 */
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { ESPHomeFirmwareInstallDialog } from "../../components/firmware-install-dialog.js";
import {
  downloadBuildArtifact,
  installLog,
  pickSerialPortOrFail,
  resetForRetry,
  touchIntoBootloaderStep,
} from "../../components/firmware-install-dialog/browser-flash-steps.js";
import { getErrorMessage } from "../../util/error-message.js";
import { BootloaderTouchError } from "../../util/serial-bootloader-touch.js";
import { loadDfuEngine } from "./index.js";
import { withManualBootloaderHint } from "./manual-bootloader-hint.js";

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

  showResetStep(host);
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
  showResetStep(host);
}

function showResetStep(host: ESPHomeFirmwareInstallDialog): void {
  host._step = "nrf-reset";
  host._statusMessage = host._localize("firmware.nrf_step1_title");
}

/** Step 1: 1200-baud touch into DFU mode. Runs from a button click (user gesture). */
export function nrfDoReset(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  return touchIntoBootloaderStep(host, {
    image: () => host._nrfPkg,
    resettingKey: "firmware.nrf_resetting",
    showNext: () => {
      host._step = "nrf-wait";
      host._statusMessage = host._localize("firmware.nrf_step2_title");
    },
    // A failed pick has nothing to do with the board; only the touch earns
    // the manual-bootloader hint.
    failureDetail: (err) =>
      err instanceof BootloaderTouchError
        ? withManualBootloaderHint(err, host._localize)
        : getErrorMessage(err),
  });
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
    // A cache hit: the engine loaded when the package was parsed.
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
        withManualBootloaderHint(err, host._localize)
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
