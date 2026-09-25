/**
 * Realtek AmebaZ2 (rtl87xx) install flow, mirroring rp2-uf2-install.ts:
 * compile, download and parse the LibreTiny UF2, then one user-gesture step
 * that picks the port and flashes through the ROM downloader. The engine
 * loads on demand so it stays out of the main chunk.
 */
import type { ConfiguredDevice } from "../../api/types/devices.js";
import { getErrorMessage } from "../../util/error-message.js";
import { parseLibreTinyImage, UF2_FAMILY_AMBZ2 } from "../../util/libretiny-uf2.js";
import { Uf2FamilyError } from "../../util/uf2.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import {
  downloadBuildArtifact,
  pickSerialPortOrFail,
  resetForRetry,
} from "./browser-flash-steps.js";

const loadEngine = () => import("../../util/ambz2-flasher.js");

/** Compile, download and parse the UF2, then hand off to the flash step. */
export async function startRtlAmbz2Install(
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
    host._rtlImage = parseLibreTinyImage(artifact.bytes, [UF2_FAMILY_AMBZ2]);
  } catch (err) {
    // Another Realtek family (AmebaZ) is a real build for a chip this engine
    // cannot flash; anything else is a bad file.
    host._fail(
      host._localize(
        err instanceof Uf2FamilyError
          ? "firmware.rtl_wrong_family"
          : "firmware.rtl_bad_uf2"
      ),
      getErrorMessage(err)
    );
    return;
  }
  host._binaries = [artifact.binary];
  showReadyStep(host);
}

function showReadyStep(host: ESPHomeFirmwareInstallDialog): void {
  host._step = "rtl-ready";
  host._statusMessage = host._localize("firmware.rtl_ready_title");
}

/** Retry after a failed flash: the image is still parsed, so skip the compile. */
export function retryRtlAmbz2(
  host: ESPHomeFirmwareInstallDialog,
  device: ConfiguredDevice
): void {
  if (!host._rtlImage) {
    host.installRtlAmbz2(device);
    return;
  }
  resetForRetry(host);
  showReadyStep(host);
}

/**
 * Pick the port and flash. The engine resets the board into download mode
 * by itself where the adapter's control lines allow it; otherwise the dialog
 * moves to the strap guide while the engine keeps polling for the ROM.
 */
export async function rtlDoFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const image = host._rtlImage;
  if (!image || host._flashBusy) return;
  const device = host._device;
  const stillCurrent = () => host._device === device && host._rtlImage === image;
  const port = await pickSerialPortOrFail(host, stillCurrent);
  if (!port) return;

  host._step = "rtl-connect";
  host._statusMessage = host._localize("firmware.rtl_connecting");
  host._flashPercent = 0;
  const abort = new AbortController();
  host._flashAbort = abort;
  try {
    const { flashAmbz2 } = await loadEngine();
    await flashAmbz2(port, image, {
      signal: abort.signal,
      onWaitingForStrap: () => {
        if (!stillCurrent()) return;
        host._step = "rtl-wait";
        host._statusMessage = host._localize("firmware.rtl_wait_title");
      },
      onLinked: () => {
        if (!stillCurrent()) return;
        host._step = "flashing";
        host._statusMessage = host._localize("firmware.status_flashing");
      },
      onProgress: (percent) => {
        if (stillCurrent()) host._flashPercent = percent;
      },
    });
  } catch (err) {
    if (stillCurrent()) {
      host._fail(host._localize("firmware.rtl_flash_failed"), getErrorMessage(err));
    }
    return;
  } finally {
    if (host._flashAbort === abort) host._flashAbort = null;
  }
  if (!stillCurrent()) return;
  host._statusMessage = host._localize("firmware.status_done");
  host._step = "done";
}
