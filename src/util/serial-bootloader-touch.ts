/**
 * The 1200-baud touch: open the CDC port at 1200 baud, drop DTR, close.
 * Native-USB firmware reboots into its bootloader on that (the Adafruit
 * nRF52 core on the line coding alone, arduino-pico once DTR also drops),
 * re-enumerating as a different USB device.
 */
import { getErrorMessage } from "./error-message.js";
import { markSerialActivity } from "./serial-reacquire.js";
import { requestSerialPort } from "./web-serial.js";

/** The touch itself failed (not the picker before it); ``message`` is the cause's. */
export class BootloaderTouchError extends Error {
  constructor(readonly cause: unknown) {
    super(getErrorMessage(cause));
    this.name = "BootloaderTouchError";
  }
}

const isPortLost = (err: unknown): boolean =>
  err instanceof DOMException &&
  (err.name === "NetworkError" || err.name === "InvalidStateError");

/**
 * ``onLog`` gets one line per step, for an install dialog's details log.
 * Fails as ``BootloaderTouchError``.
 */
export async function resetToBootloader(
  port: SerialPort,
  onLog: (line: string) => void = () => {}
): Promise<void> {
  try {
    await touch(port, onLog);
  } catch (err) {
    throw new BootloaderTouchError(err);
  }
}

async function touch(port: SerialPort, onLog: (line: string) => void): Promise<void> {
  // The re-enumeration is ours; keep the "USB device connected" toast quiet.
  markSerialActivity();
  // A handle left open by an earlier touch whose close raced the reboot
  // would make open() throw "already open"; release it first.
  if (port.readable) await port.close().catch(() => {});
  onLog("Touching the port at 1200 baud");
  await port.open({ baudRate: 1200 });
  try {
    // Drop DTR ourselves rather than through close(): the device reboots the
    // instant it drops, and a close() racing that can leave the OS handle
    // held until the page is reloaded.
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch (err) {
    // Already gone: it rebooted on the line coding alone (nRF52). Anything
    // else means DTR never dropped, so an RP2 would not have reset.
    if (!isPortLost(err)) throw err;
    onLog("The device rebooted on the line coding alone");
  }
  try {
    await port.close();
  } catch (err) {
    // The device vanished mid-close; that is the reboot we asked for.
    if (!isPortLost(err)) throw err;
  }
  onLog("Port released; the device re-enumerates as its bootloader");
}

/**
 * The touch from a button click: pick the CDC port (narrowed by ``filters``
 * where the board's ids are known, and checked by ``accept`` where the ids
 * alone can't tell), then reset. False when the picker was dismissed; a
 * failed touch throws ``BootloaderTouchError``, a refused pick
 * ``PortNotAcceptedError`` (untouched), a failed pick the browser's own error.
 */
export async function touchIntoBootloader({
  onLog,
  filters,
  accept,
}: {
  onLog?: (line: string) => void;
  filters?: SerialPortRequestOptions["filters"];
  accept?: (port: SerialPort) => boolean;
} = {}): Promise<boolean> {
  const port = await requestSerialPort(filters ? { filters } : undefined, accept);
  if (!port) return false;
  await resetToBootloader(port, onLog);
  return true;
}
