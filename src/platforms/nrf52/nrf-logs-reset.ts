/**
 * Reset device for an nRF52 streaming logs. Its CDC has no reset line, and
 * the 1200-baud touch lands in the Adafruit bootloader, which has no way back
 * into the app short of a flash; so ESPHome reboots straight into the app on
 * a 2001-baud touch instead (esphome/esphome#19727). Firmware older than that
 * ignores it and stays attached.
 */
import { touchPort } from "../../util/serial-bootloader-touch.js";
import { openLiveSerialPort } from "../../util/serial-reacquire.js";
import { sleep } from "../../util/sleep.js";

/** The line coding ESPHome's nRF52 firmware reboots into its app on. */
export const NRF_RESET_BAUD_RATE = 2001;
// The reboot drops the port within a few hundred ms; still attached after
// this, the firmware ignored the touch.
const REBOOT_WAIT_MS = 3000;
const REBOOT_POLL_MS = 100;

/** ESPHome on an nRF52 is a Zephyr USB device; only its own CDC takes the touch. */
export const ZEPHYR_USB_VID = 0x2fe3;

export const isNrfAppCdcPort = (port: SerialPort): boolean =>
  port.getInfo().usbVendorId === ZEPHYR_USB_VID;

/** The firmware ignored the reset touch: it predates the 2001-baud reboot. */
export class NrfResetIgnoredError extends Error {
  constructor() {
    super("The device ignored the reset; it needs a newer ESPHome");
    this.name = "NrfResetIgnoredError";
  }
}

/**
 * Reboot the nRF52 behind *port* (closed by the caller) into its app; its CDC
 * port re-enumerates afterwards. False when ``cancelled`` flipped before the
 * touch. Throws ``NrfResetIgnoredError`` when the device never drops.
 */
export async function rebootNrf(
  port: SerialPort,
  cancelled: () => boolean
): Promise<boolean> {
  if (cancelled()) return false;
  await touchPort(port, NRF_RESET_BAUD_RATE);
  const deadline = Date.now() + REBOOT_WAIT_MS;
  while (port.connected !== false) {
    if (Date.now() >= deadline) throw new NrfResetIgnoredError();
    await sleep(REBOOT_POLL_MS);
  }
  return true;
}

/**
 * ``rebootNrf``, then the CDC port reopened at *baudRate*: null when the
 * reboot was cancelled before the touch or the device never came back.
 */
export async function resetNrfForLogs(
  port: SerialPort,
  baudRate: number,
  cancelled: () => boolean
): Promise<SerialPort | null> {
  if (!(await rebootNrf(port, cancelled))) return null;
  return openLiveSerialPort(port, { baudRate, cancelled });
}

/** The copy key for a failed nRF52 reset: firmware too old is named, else ``plainKey``. */
export function nrfResetFailureKey(err: unknown, plainKey: string): string {
  return err instanceof NrfResetIgnoredError
    ? "firmware.nrf_reset_needs_newer_esphome"
    : plainKey;
}
