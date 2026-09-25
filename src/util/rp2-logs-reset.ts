/**
 * Reset Device for a Pico streaming logs. Its CDC has no reset line, so the
 * only way back into the firmware is the 1200-baud touch into BOOTSEL and a
 * PICOBOOT reboot over WebUSB, after which the CDC port re-enumerates.
 */
import { resetToBootloader } from "./serial-bootloader-touch.js";
import { sleep } from "./sleep.js";
import { openLiveSerialPort } from "./web-serial.js";
import { getPicobootDevices, requestPicobootDevice } from "./web-usb.js";

const BOOTSEL_POLL_MS = 200;
// Kept well inside the click's transient activation so the chooser fallback
// is still allowed when the poll gives up.
const BOOTSEL_WAIT_MS = 2000;

/** The touch landed but the reboot did not: the Pico is sitting in BOOTSEL. */
export class PicoStrandedError extends Error {
  cause: unknown;

  constructor(cause: unknown) {
    super("Pico left in BOOTSEL");
    this.name = "PicoStrandedError";
    this.cause = cause;
  }
}

/**
 * Reboot the Pico behind *port* (closed by the caller) and return its CDC port
 * reopened at *baudRate*, or null when it never came back. Throws
 * ``PicoStrandedError`` once the device is in BOOTSEL and cannot be rebooted;
 * a failed touch rethrows as is.
 */
export async function resetPicoForLogs(
  port: SerialPort,
  baudRate: number
): Promise<SerialPort | null> {
  await resetToBootloader(port);
  try {
    const usb = await findBootselDevice();
    if (!usb) throw new Error("chooser dismissed");
    const { PicobootDevice } = await import("./rp2-picoboot.js");
    const dev = await PicobootDevice.open(usb);
    try {
      await dev.reboot();
    } finally {
      await dev.close();
    }
  } catch (err) {
    throw new PicoStrandedError(err);
  }
  return openLiveSerialPort(port, { baudRate });
}

// A bootloader this origin was granted before shows up in getDevices() once
// it enumerates, so a repeat reset skips the chooser; the chooser lists the
// device live, so it can open before the Pico is back.
async function findBootselDevice(): Promise<USBDevice | null> {
  const deadline = Date.now() + BOOTSEL_WAIT_MS;
  for (;;) {
    const [granted] = await getPicobootDevices();
    if (granted) return granted;
    if (Date.now() >= deadline) return requestPicobootDevice();
    await sleep(BOOTSEL_POLL_MS);
  }
}
