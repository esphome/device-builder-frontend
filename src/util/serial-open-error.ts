import type { LocalizeFunc } from "../common/localize.js";
import { getErrorMessage } from "./error-message.js";

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

/** The copy for a failed manual open: "may be in use" when it is, else ``fallbackKey`` with the error. */
export function openFailureMessage(
  err: unknown,
  localize: LocalizeFunc,
  fallbackKey = "serial.open_failed"
): string {
  return (
    portInUseMessage(err, localize) ??
    localize(fallbackKey, { error: getErrorMessage(err) })
  );
}
