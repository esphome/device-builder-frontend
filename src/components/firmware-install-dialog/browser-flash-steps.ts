/**
 * The steps every compile-first browser flasher (nRF52 DFU, Pico UF2,
 * RTL8720C ROM) shares: fetching the build artifact into memory, going back
 * to its bootloader step on Retry, and the port picker with its failure
 * reported. Kept out of install-flow.ts for the line budget.
 */
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { FirmwareBinary } from "../../api/types/firmware-jobs.js";
import { getErrorMessage } from "../../util/error-message.js";
import { requestSerialPort } from "../../util/web-serial.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import { compileOrFail, failNoBinaries, fetchBinaries } from "./install-flow.js";

export interface BuildArtifact {
  binary: FirmwareBinary;
  bytes: Uint8Array;
}

/**
 * Compile, list the artefacts, pick one with ``pick`` and download it.
 * Null means the failure is already on the dialog, or the dialog moved to
 * another device meanwhile (it is reused; a close-and-reopen during an await
 * must not receive this install's image).
 */
export async function downloadBuildArtifact(
  host: ESPHomeFirmwareInstallDialog,
  device: ConfiguredDevice,
  pick: (binary: FirmwareBinary) => boolean,
  noArtifactKey: string
): Promise<BuildArtifact | null> {
  const stale = () => host._device !== device;
  if (!(await compileOrFail(host, device.configuration)) || stale()) return null;

  host._statusMessage = host._localize("firmware.status_downloading");
  const binaries = await fetchBinaries(host, device.configuration);
  if (!binaries || stale()) return null;
  if (binaries.length === 0) {
    failNoBinaries(host, { isWebFlasher: false, isEmpty: true });
    return null;
  }
  const binary = binaries.find(pick);
  if (!binary) {
    host._fail(host._localize(noArtifactKey));
    return null;
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(
      await host._api.firmwareDownloadBytes(device.configuration, binary.file)
    );
  } catch (err) {
    if (!stale())
      host._fail(host._localize("firmware.download_failed"), getErrorMessage(err));
    return null;
  }
  return stale() ? null : { binary, bytes };
}

/** Back to a bootloader step after a failed reset or flash, image kept. */
export function resetForRetry(host: ESPHomeFirmwareInstallDialog): void {
  host._errorMessage = "";
  host._flashPercent = 0;
  host._flashBusy = false;
}

/**
 * The Web Serial picker from a footer click. Null when dismissed, when the
 * dialog moved on, or when the failure is already on the dialog.
 */
export async function pickSerialPortOrFail(
  host: ESPHomeFirmwareInstallDialog,
  stillCurrent: () => boolean
): Promise<SerialPort | null> {
  host._flashBusy = true;
  try {
    const port = await requestSerialPort();
    return stillCurrent() ? port : null;
  } catch (err) {
    if (stillCurrent()) {
      host._fail(
        host._localize("firmware.browser_flash_connect_failed"),
        getErrorMessage(err)
      );
    }
    return null;
  } finally {
    if (stillCurrent()) host._flashBusy = false;
  }
}

/**
 * An engine's step lines land in the details log, as esptool's do; a line
 * that arrives after the dialog moved on to another install is dropped.
 */
export function installLog(
  host: ESPHomeFirmwareInstallDialog,
  stillCurrent: () => boolean
): (line: string) => void {
  return (line) => {
    if (stillCurrent()) host._log.enqueue(line);
  };
}
