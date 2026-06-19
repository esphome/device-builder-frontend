import type { ConfiguredDevice } from "../api/types/devices.js";
import type { ESPHomeFirmwareInstallDialog } from "./firmware-install-dialog.js";

export interface InstallMethodHandlers {
  device: ConfiguredDevice;
  /** Run the backend/OTA install with an optional address override
   *  ("OTA" sentinel for the default address, a server serial port, etc.). */
  openInstall: (port?: string) => void;
  firmwareDialog: ESPHomeFirmwareInstallDialog | null;
}

/**
 * Route an install-method-picker selection to its action. Shared by the
 * dashboard and the device editor so the method switch lives in one place.
 */
export function applyInstallMethod(
  method: string,
  port: string | undefined,
  h: InstallMethodHandlers
): void {
  switch (method) {
    case "ota":
      // ``port`` is the user-typed address override from the OTA option's
      // expanded form; the "OTA" sentinel is the default-address path.
      h.openInstall(port ?? "OTA");
      break;
    case "server-serial":
      // server-serial always carries the chosen port; guard rather than assert
      // so a malformed event can't open the install command without one.
      if (port) h.openInstall(port);
      break;
    case "web-serial":
      h.firmwareDialog?.installWebSerial(h.device);
      break;
    case "web-flash":
      // In-app Web Serial isn't available here; compile + download in the
      // dialog, then hand off to the external secure-context flasher.
      h.firmwareDialog?.installUsbFlash(h.device);
      break;
    case "binary-download":
      h.firmwareDialog?.installBinaryDownload(h.device);
      break;
  }
}
