/**
 * Raspberry Pi Pico (rp2) install flow, mirroring the nRF52 one (dfu-install.ts):
 * compile, download and parse the UF2, then two user-gesture steps. The
 * PICOBOOT engine loads on demand so it stays out of the main chunk.
 */
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { ESPHomeFirmwareInstallDialog } from "../../components/firmware-install-dialog.js";
import {
  downloadBuildArtifact,
  installLog,
  retryParsedInstall,
  touchIntoBootloaderStep,
} from "../../components/firmware-install-dialog/browser-flash-steps.js";
import { downloadSelectedBinary } from "../../components/firmware-install-dialog/install-flow.js";
import { getErrorMessage } from "../../util/error-message.js";
import {
  parseUf2Image,
  UF2_FAMILY_RP2040,
  UF2_FAMILY_RP2350_ARM_S,
  Uf2FamilyError,
} from "../../util/uf2.js";
import { flashPico, PicoFlashError, picoFlashFailureCopy } from "./rp2-flash.js";

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
  retryParsedInstall(
    host,
    host._rp2Image,
    () => host.installRp2Uf2(device),
    () => showBootselStep(host)
  );
}

/** Step 1: 1200-baud touch into BOOTSEL. Runs from a button click (user gesture). */
export function rp2DoReset(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  return touchIntoBootloaderStep(host, {
    image: () => host._rp2Image,
    resettingKey: "firmware.rp2_resetting",
    dismissedKey: "firmware.rp2_bootsel_title",
    next: "rp2-wait",
    nextTitleKey: "firmware.rp2_wait_title",
  });
}

/** Step 2 with WebUSB: pick the RP2 Boot device and write over PICOBOOT. */
export async function rp2DoFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const image = host._rp2Image;
  if (!image || host._flashBusy) return;
  const device = host._device;
  const stillCurrent = () => host._device === device && host._rp2Image === image;
  host._flashBusy = true;
  const abort = new AbortController();
  host._flashAbort = abort;
  let flashed: boolean;
  try {
    flashed = await flashPico(image, {
      signal: abort.signal,
      cancelled: () => !stillCurrent(),
      onLog: installLog(host, stillCurrent),
      onDeviceOpened: () => {
        // The chooser is done; the write runs with the step shown.
        host._flashBusy = false;
        host._step = "flashing";
        host._statusMessage = host._localize("firmware.status_flashing");
        host._flashPercent = 0;
      },
      onProgress: (percent) => {
        if (stillCurrent()) host._flashPercent = percent;
      },
    });
  } catch (err) {
    if (!stillCurrent()) return;
    if (err instanceof PicoFlashError) {
      const { title, detail } = picoFlashFailureCopy(err, host._localize);
      host._fail(title, detail);
    } else {
      host._fail(host._localize("firmware.rp2_flash_failed"), getErrorMessage(err));
    }
    return;
  } finally {
    if (stillCurrent()) host._flashBusy = false;
    if (host._flashAbort === abort) host._flashAbort = null;
  }
  if (!flashed || !stillCurrent()) return;
  host._statusMessage = host._localize("firmware.status_done");
  host._step = "done";
}

/** Step 2 without WebUSB: save the UF2 for a manual copy onto the RPI-RP2 drive. */
export function rp2DoDownload(host: ESPHomeFirmwareInstallDialog): void {
  const file = host._binaries[0]?.file;
  if (!file || host._flashBusy) return;
  void downloadSelectedBinary(host, file);
}
