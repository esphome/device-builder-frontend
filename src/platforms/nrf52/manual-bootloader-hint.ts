import type { LocalizeFunc } from "../../common/localize.js";
import { getErrorMessage } from "../../util/error-message.js";
import { BootloaderTouchError } from "../../util/serial-bootloader-touch.js";
import { SerialDeviceLostError } from "../../util/serial-open-error.js";
import { DfuResponseError } from "./dfu-response-error.js";

/** How to enter the bootloader by hand: the Adafruit bootloader's double-press. */
export const DOUBLE_PRESS_HINT_KEY = "firmware.nrf_manual_bootloader_hint";
/** The nRF52840 Dongle's: its RESET button. */
export const DONGLE_RESET_HINT_KEY = "firmware.nrf_open_manual_bootloader_hint";

/**
 * ``err``'s message joined with the nRF52 way out when the 1200-baud touch
 * or the DFU handshake fails: enter the bootloader by hand, as ``hintKey``
 * says for the board's bootloader. An abort is the dialog's own teardown and
 * stays bare, a device that went away has a line of its own, and a
 * bootloader that answered with a refusal is already entered.
 */
export function withManualBootloaderHint(
  err: unknown,
  localize: LocalizeFunc,
  hintKey = DOUBLE_PRESS_HINT_KEY
): string {
  // A board that was unplugged is not one to put into its bootloader.
  if (err instanceof SerialDeviceLostError) return localize("serial.device_lost");
  const message = getErrorMessage(err);
  if (err instanceof DOMException && err.name === "AbortError") return message;
  if (err instanceof DfuResponseError) return message;
  // The joined sentence is one translatable string; a browser message that
  // already ends with a period would otherwise double it.
  return localize(hintKey, { error: message.replace(/\.\s*$/, "") });
}

/**
 * The detail of a failed step into the bootloader. A failed pick has nothing
 * to do with the board; only the touch earns the manual-bootloader hint.
 */
export function touchFailureDetail(
  err: unknown,
  localize: LocalizeFunc,
  hintKey = DOUBLE_PRESS_HINT_KEY
): string {
  return err instanceof BootloaderTouchError
    ? withManualBootloaderHint(err, localize, hintKey)
    : getErrorMessage(err);
}
