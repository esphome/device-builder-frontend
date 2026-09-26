/**
 * Reset device for an nRF52 streaming logs. Its CDC has no reset line, and
 * the 1200-baud touch lands in the Adafruit bootloader, which has no way back
 * into the app short of a flash; so ESPHome reboots straight into the app on
 * a 2001-baud touch instead (esphome/esphome#19727). Firmware older than that
 * ignores it, and the logs say to update ESPHome.
 */
import { touchPort } from "../../util/serial-bootloader-touch.js";
import { sleep } from "../../util/sleep.js";

/** The line coding ESPHome's nRF52 firmware reboots into its app on. */
const NRF_RESET_BAUD_RATE = 2001;
// The reboot drops the port within a few hundred ms; still attached after
// this, the firmware ignored the touch.
const REBOOT_WAIT_MS = 3000;
const REBOOT_POLL_MS = 100;

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
  // The disconnect event covers a browser without ``connected``; listening
  // before the touch catches a drop that lands while the port closes.
  let dropped = false;
  const onDisconnect = () => (dropped = true);
  port.addEventListener("disconnect", onDisconnect);
  try {
    await touchPort(port, NRF_RESET_BAUD_RATE);
    const deadline = Date.now() + REBOOT_WAIT_MS;
    while (!dropped && port.connected !== false) {
      if (Date.now() >= deadline) throw new NrfResetIgnoredError();
      await sleep(REBOOT_POLL_MS);
    }
  } finally {
    port.removeEventListener("disconnect", onDisconnect);
  }
  return true;
}

/** The copy key for a failed nRF52 reset: firmware too old is named; anything else has none. */
export function nrfResetFailureKey(err: unknown): string | undefined {
  return err instanceof NrfResetIgnoredError
    ? "firmware.nrf_reset_needs_newer_esphome"
    : undefined;
}
