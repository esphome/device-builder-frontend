import type { LocalizeFunc } from "../../common/localize.js";
import { getErrorMessage } from "../../util/error-message.js";

/**
 * ``err``'s message joined with the nRF52 way out when the 1200-baud touch
 * or the DFU handshake fails: enter the bootloader by hand. An abort is the
 * dialog's own teardown and stays bare.
 */
export function withManualBootloaderHint(err: unknown, localize: LocalizeFunc): string {
  const message = getErrorMessage(err);
  if (err instanceof DOMException && err.name === "AbortError") return message;
  // The joined sentence is one translatable string; a browser message that
  // already ends with a period would otherwise double it.
  return localize("firmware.nrf_manual_bootloader_hint", {
    error: message.replace(/\.\s*$/, ""),
  });
}
