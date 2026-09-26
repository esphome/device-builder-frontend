import type { LocalizeFunc } from "../common/localize.js";
import { getErrorMessage } from "./error-message.js";

/**
 * Whether a failed ``SerialPort.open()`` most likely means something else
 * holds the port. Chrome throws ``NetworkError`` for every failed open, and on
 * a manual open that is almost always another tab, window or program; it can
 * also be a permissions or driver problem, so the copy hedges and carries the
 * error. A board still re-enumerating after a reset throws the same, so only
 * use this on a manual open where nothing just restarted.
 */
export function isPortInUse(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NetworkError";
}

/**
 * The copy for a failed manual open: "likely in use" when it is, else ``fallback``
 * (by default the generic open failure with the error's text).
 */
export function openFailureMessage(
  err: unknown,
  localize: LocalizeFunc,
  fallback = localize("serial.open_failed", { error: getErrorMessage(err) })
): string {
  return isPortInUse(err)
    ? localize("serial.port_in_use", { error: getErrorMessage(err) })
    : fallback;
}
