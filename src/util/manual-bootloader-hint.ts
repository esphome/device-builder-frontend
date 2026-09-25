/**
 * The nRF52 way out when the 1200-baud touch or the DFU handshake fails:
 * enter the bootloader by hand. Shared by the dashboard's install dialog and
 * web.esphome.io's, which word it under their own keys.
 */
import type { LocalizeFunc } from "../common/localize.js";
import { getErrorMessage } from "./error-message.js";

/**
 * ``err``'s message joined with the manual-bootloader hint under ``key``
 * (``{error}`` placeholder). An abort is the dialog's own teardown and
 * stays bare.
 */
export function withManualBootloaderHint(
  err: unknown,
  localize: LocalizeFunc,
  key: string
): string {
  const message = getErrorMessage(err);
  if (err instanceof DOMException && err.name === "AbortError") return message;
  // The joined sentence is one translatable string; a browser message that
  // already ends with a period would otherwise double it.
  return localize(key, { error: message.replace(/\.\s*$/, "") });
}
