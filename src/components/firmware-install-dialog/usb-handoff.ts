import type { FirmwareBinary } from "../../api/types/firmware-jobs.js";
import { openFlasher } from "../../util/usb-flasher.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import { compileOrFail, failNoBinaries, fetchBinaries } from "./install-flow.js";

/**
 * The self-contained image flashed from scratch at 0x0. ESP8266 / ESP8285 is
 * the single ``firmware.bin``; ESP32 is the merged ``*.factory.bin`` (its plain
 * ``firmware.bin`` is the app-only image at 0x10000, not flashable from 0x0).
 * Returns undefined when no from-scratch image was produced.
 *
 * Distinct from ``pickFlashTarget`` on purpose: web-flash only has the coarse
 * ``target_platform`` (no chip yet), so it matches strictly and has no
 * ``binaries[0]`` fallback. Don't unify the two.
 */
export function pickFactoryBinary(
  targetPlatform: string,
  binaries: FirmwareBinary[]
): FirmwareBinary | undefined {
  if (targetPlatform.toLowerCase().startsWith("esp82")) {
    return binaries.find((b) => b.file === "firmware.bin");
  }
  return (
    binaries.find((b) => b.file === "firmware.factory.bin") ??
    binaries.find((b) => b.file.endsWith(".factory.bin"))
  );
}

// "Flash via USB" through the external flasher: compile + download the factory
// image HERE (logs/errors visible, like the download flow), then land on the
// download-ready step. The flasher tab is opened only afterwards, on the user's
// click, so we never hand off until a working firmware exists.
export async function startUsbFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const device = host._device;
  if (!device) return;
  if (!(await compileOrFail(host, device.configuration))) return;
  host._statusMessage = host._localize("firmware.status_downloading");
  host._step = "downloading";
  const binaries = await fetchBinaries(host, device.configuration);
  if (!binaries) return;
  const factory = pickFactoryBinary(device.target_platform, binaries);
  if (!factory) {
    failNoBinaries(host, { isWebFlasher: true, isEmpty: binaries.length === 0 });
    return;
  }
  try {
    host._usbFirmware = await host._api.firmwareDownloadBytes(
      device.configuration,
      factory.file
    );
    host._usbFirmwareName = factory.file;
  } catch {
    host._fail(host._localize("firmware.download_failed"));
    return;
  }
  host._step = "download-ready";
  host._statusMessage = "";
}

// Open the external flasher and hand off the already-built firmware, mirroring
// its progress/result into the dialog. Called from the download-ready "Open USB
// flasher" button (a user gesture, so the pop-up isn't blocked).
export function handOffToFlasher(host: ESPHomeFirmwareInstallDialog): void {
  const firmware = host._usbFirmware;
  if (!firmware) return;
  host._step = "flashing";
  host._flashPercent = 0;
  host._statusMessage = host._localize("firmware.usb_flashing");
  host._errorMessage = "";
  const deviceName = host._device ? host._device.friendly_name || host._device.name : "";
  // An in-tab retry after a failure resumes via progress/status frames; leave
  // the error view and clear the failure banner so it doesn't headline a flash
  // that's already running (a progress frame often lands before a status one).
  const resumeFromError = () => {
    if (host._step !== "error") return;
    host._step = "flashing";
    host._errorMessage = "";
    host._statusMessage = host._localize("firmware.usb_flashing");
  };
  const teardown = openFlasher(firmware, host._usbFirmwareName, deviceName, {
    onProgress: (pct) => {
      resumeFromError();
      host._flashPercent = pct;
    },
    onStatus: (detail) => {
      resumeFromError();
      host._statusMessage = detail;
    },
    onState: (state, detail) => {
      if (state === "done") {
        host._usbFlashTeardown = null;
        host._step = "done";
        host._statusMessage = host._localize("firmware.usb_done");
      } else {
        // Non-terminal: the flasher tab can retry in place, so keep the
        // teardown live for a later success or close.
        host._fail(host._localize("firmware.usb_failed"), detail);
      }
    },
    onLost: () => {
      host._usbFlashTeardown = null;
      host._fail(
        host._localize("firmware.usb_failed"),
        host._localize("firmware.usb_window_closed")
      );
    },
    onUnsupported: () => {
      host._usbFlashTeardown = null;
      // Retrying would recompile and re-open a tab that declines again for the
      // same reason; suppress the Retry footer (mirrors chip-mismatch).
      host._failureKind = "unsupported-browser";
      host._fail(
        host._localize("firmware.usb_failed"),
        host._localize("firmware.usb_unsupported_browser")
      );
    },
  });
  if (!teardown) {
    // Pop-up blocked: stay on download-ready with the firmware still in hand so
    // the user can allow pop-ups and click Open again, rather than being forced
    // through a full recompile. The message surfaces in the ready-screen detail.
    host._step = "download-ready";
    host._statusMessage = "";
    host._errorMessage = host._localize("firmware.usb_popup_blocked");
    return;
  }
  // The openFlasher session now holds the bytes (in its closure) and transfers
  // them to the tab on the ready hand-off; drop the dialog's reference. A retry
  // after a lost/never-ready tab recompiles, which is incremental and cheap.
  host._usbFirmware = null;
  host._usbFlashTeardown = teardown;
}
