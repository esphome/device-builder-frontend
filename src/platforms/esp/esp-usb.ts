/**
 * What the rest of the app needs from the ESP support without esptool-js:
 * the USB ids, the errors callers check, and the plain types. The engine
 * itself is ``esptool.ts``, loaded on demand.
 */
import { getErrorMessage } from "../../util/error-message.js";

/** Espressif's USB Vendor ID — chips with native USB-Serial/JTAG. */
export const ESPRESSIF_USB_VID = 0x303a;

/** The on-chip USB-Serial-JTAG device's product id — esptool-js's own
 *  discriminator (it gates on this PID alone). The vendor id alone is not
 *  native-USB proof: Espressif also ships real UART bridges under it
 *  (ESP-USB-Bridge, 0x1002); we pair both as the conservative check. */
const ESPRESSIF_USB_JTAG_PID = 0x1001;

/** Whether *port* is a chip's own USB-Serial-JTAG device (vs any bridge). */
export function isEspressifUsbJtagPort(port: SerialPort): boolean {
  const { usbVendorId, usbProductId } = port.getInfo();
  return usbVendorId === ESPRESSIF_USB_VID && usbProductId === ESPRESSIF_USB_JTAG_PID;
}

export interface FlashProgress {
  fileIndex: number;
  written: number;
  total: number;
  percent: number;
}

/** The esptool chunk could not be fetched (offline, a deploy replaced it). */
export class EngineLoadError extends Error {
  constructor(readonly cause: unknown) {
    super(getErrorMessage(cause));
    this.name = "EngineLoadError";
  }
}

/** The connected chip has no esptool-js target; flashing needs the esptool CLI. */
export class UnsupportedChipError extends Error {
  readonly chipName: string;

  constructor(chipName: string) {
    // Surfaces raw through err.message on the wizard / dashboard-scan paths,
    // so the message itself carries the next step.
    super(
      `${chipName} is not supported by browser flashing yet — download the ` +
        `firmware and flash it with esptool from the command line instead`
    );
    this.name = "UnsupportedChipError";
    this.chipName = chipName;
  }
}

/**
 * Manifest fields read from the ESP-IDF app descriptor
 * (``esp_app_desc_t``) — a 256-byte struct at offset 0x20 of every
 * IDF app image. With ESPHome's default partition layout the app
 * partition starts at 0x10000, so the descriptor lives at 0x10020
 * and is readable from the ROM bootloader over USB-CDC. No custom
 * partition table required.
 *
 * ``board_id`` is sourced from ``esp_app_desc_t.project_name`` (the
 * CMake project name baked in at build time, which ESPHome currently
 * populates from ``esphome.name``). A vendor flashing a factory
 * image just sets ``esphome.name`` to the catalog id; the wizard
 * routes off it via ``api.getBoard(board_id)``.
 */
export interface DeviceManifest {
  /** Board catalog id — ``esp_app_desc_t.project_name``. Routes the wizard. */
  board_id?: string;
  /** ``esp_app_desc_t.version``. */
  version?: string;
}
