/**
 * Reset Device for a Pico streaming logs. Its CDC has no reset line, so the
 * only way back into the firmware is the 1200-baud touch into BOOTSEL and a
 * PICOBOOT reboot over WebUSB, after which the CDC port re-enumerates.
 */
import { resetToBootloader } from "./serial-bootloader-touch.js";
import { sleep } from "./sleep.js";
import { openLiveSerialPort } from "./web-serial.js";
import {
  classifyUsbDevice,
  getPicobootDevices,
  isUsbAccessDenied,
  loadPicoboot,
  requestPicobootDevice,
} from "./web-usb.js";

const BOOTSEL_POLL_MS = 200;
// Counted from before the touch, well inside the click's transient activation,
// so the chooser fallback is still allowed when the poll gives up.
const BOOTSEL_WAIT_MS = 2000;

/**
 * The touch landed but the reboot did not: the Pico is sitting in BOOTSEL.
 * ``step`` says where it stopped: no bootloader picked (dismissed chooser or
 * lapsed activation), the browser refused the device, or the reboot failed.
 */
export class PicoStrandedError extends Error {
  constructor(
    readonly step: "pick" | "refused" | "reboot",
    // Error.cause needs lib ES2022; the field is declared here instead.
    readonly cause?: unknown
  ) {
    super(`Pico left in BOOTSEL (${step})`);
    this.name = "PicoStrandedError";
  }
}

/**
 * Reboot the Pico behind *port* (closed by the caller) and return its CDC port
 * reopened at *baudRate*, or null when it never came back or ``cancelled``
 * flipped. Throws ``PicoStrandedError`` once the device is in BOOTSEL and
 * cannot be rebooted; a failed touch rethrows as is.
 */
export async function resetPicoForLogs(
  port: SerialPort,
  baudRate: number,
  cancelled: () => boolean
): Promise<SerialPort | null> {
  const deadline = Date.now() + BOOTSEL_WAIT_MS;
  // Only a bootloader that appears after the touch is this Pico; another
  // granted board already sitting in BOOTSEL must not be rebooted instead.
  const before = await getPicobootDevices();
  await resetToBootloader(port);
  let usb: USBDevice | null;
  try {
    usb = await findBootselDevice(deadline, before, cancelled);
  } catch (err) {
    throw noBootloader(port, cancelled, err);
  }
  if (!usb) throw noBootloader(port, cancelled);
  // The chooser also lists RP2350 bootloaders; REBOOT is RP2040-only.
  if (classifyUsbDevice(usb) !== "rp2040") {
    throw new PicoStrandedError("reboot", "RP2350 is not supported");
  }
  const { PicobootDevice } = await loadPicoboot();
  const dev = await PicobootDevice.open(usb).catch((err: unknown) => {
    throw new PicoStrandedError(isUsbAccessDenied(err) ? "refused" : "reboot", err);
  });
  try {
    await dev.reboot();
  } catch (err) {
    throw new PicoStrandedError("reboot", err);
  } finally {
    await dev.close();
  }
  return openLiveSerialPort(port, { baudRate, cancelled });
}

// No bootloader to reboot. A CDC handle still connected means the firmware
// ignored the touch, a plain reset failure; unless the poll was cancelled
// early, when the Pico may only be on its way into BOOTSEL.
function noBootloader(
  port: SerialPort,
  cancelled: () => boolean,
  cause?: unknown
): Error {
  if (port.connected && !cancelled()) {
    return new Error(
      `The Pico ignored the 1200-baud touch${cause === undefined ? "" : ` (${String(cause)})`}`
    );
  }
  return new PicoStrandedError("pick", cause);
}

// A bootloader this origin was granted before shows up in getDevices() once
// it enumerates, so a repeat reset skips the chooser; the chooser lists the
// device live, so it can open before the Pico is back.
async function findBootselDevice(
  deadline: number,
  before: USBDevice[],
  cancelled: () => boolean
): Promise<USBDevice | null> {
  for (;;) {
    if (cancelled()) return null;
    const granted = (await getPicobootDevices()).find((d) => !before.includes(d));
    if (granted) return granted;
    if (Date.now() >= deadline) return requestPicobootDevice();
    await sleep(BOOTSEL_POLL_MS);
  }
}
