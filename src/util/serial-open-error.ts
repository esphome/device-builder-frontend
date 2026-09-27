import type { LocalizeFunc } from "../common/localize.js";
import { getErrorMessage } from "./error-message.js";

// The copy for a failed serial open or connect, and the errors it names.
//
// Rejections that came from ``SerialPort.open()`` itself. A read or write
// on a device that dropped mid-session throws ``NetworkError`` too, and that
// one must not read as another program holding the port.
const openFailures = new WeakSet<object>();

/** Remember ``err`` as the rejection of a ``SerialPort.open()`` call. */
export function markOpenFailure(err: unknown): void {
  if (typeof err === "object" && err !== null) openFailures.add(err);
}

/** ``port.open(options)``, marking a rejection as an open failure. */
export async function openSerialPort(
  port: SerialPort,
  options: SerialOptions
): Promise<void> {
  try {
    await port.open(options);
  } catch (err) {
    markOpenFailure(err);
    throw err;
  }
}

/**
 * Whether a failed open most likely means something else holds the port.
 * Chrome throws ``NetworkError`` for every failed open, and on a manual open
 * that is almost always another tab, window or program; it can also be a
 * permissions or driver problem, so the copy hedges and carries the error. A
 * board still re-enumerating after a reset throws the same, so only use this
 * on a manual open where nothing just restarted.
 */
function isPortInUse(err: unknown): boolean {
  return (
    err instanceof DOMException && err.name === "NetworkError" && openFailures.has(err)
  );
}

/** The "may be open elsewhere" copy for a failed manual open, or undefined. */
export function portInUseMessage(
  err: unknown,
  localize: LocalizeFunc
): string | undefined {
  return isPortInUse(err)
    ? localize("serial.port_in_use", { error: getErrorMessage(err) })
    : undefined;
}

/** A device never answered the connect handshake before the deadline. */
export class SerialConnectTimeoutError extends Error {
  readonly seconds: number;

  constructor(deadlineMs: number) {
    const seconds = Math.round(deadlineMs / 1000);
    super(`No answer from the device in ${seconds} s`);
    this.name = "SerialConnectTimeoutError";
    this.seconds = seconds;
  }
}

/**
 * The copy for a failed connect that can be named: the port held elsewhere,
 * or the device never answering; undefined for anything else.
 */
export function namedConnectFailure(
  err: unknown,
  localize: LocalizeFunc
): string | undefined {
  if (err instanceof SerialConnectTimeoutError) {
    return localize("serial.connect_timed_out", { seconds: err.seconds });
  }
  return portInUseMessage(err, localize);
}

/** The copy for a failed manual open or connect: a named failure when it is one, else ``fallbackKey`` with the error. */
export function openFailureMessage(
  err: unknown,
  localize: LocalizeFunc,
  fallbackKey = "serial.open_failed"
): string {
  return (
    namedConnectFailure(err, localize) ??
    localize(fallbackKey, { error: getErrorMessage(err) })
  );
}
