import toast from "sonner-js";

import type { LocalizeFunc } from "../../../common/localize.js";
import { RP2_SERIAL_PICK } from "../../../platforms/rp2/index.js";
import { getErrorMessage } from "../../../util/error-message.js";
import { PortNotAcceptedError, requestSerialPort } from "../../../util/web-serial.js";

/**
 * The Pico's pick (``RP2_SERIAL_PICK``, shared with the Device Builder): any
 * Raspberry Pi USB device in the picker, with a debug probe turned away after
 * the pick. Spread into ``touchIntoBootloader``; ``pickPicoPort`` uses it too.
 */
export const PICO_PICK = RP2_SERIAL_PICK;

/** Toasted when the pick turned out to be a debug probe. */
export const PROBE_PICKED_KEY = "web.pico.probe_picked";

/**
 * Pick a Pico's own CDC port. Null when the picker was dismissed or the pick
 * failed; a failure, or a debug probe picked by mistake, is toasted here.
 */
export async function pickPicoPort(localize: LocalizeFunc): Promise<SerialPort | null> {
  try {
    return await requestSerialPort({ filters: PICO_PICK.filters }, PICO_PICK.accept);
  } catch (err) {
    toast.error(
      err instanceof PortNotAcceptedError
        ? localize(PROBE_PICKED_KEY)
        : localize("web.connect.failed", { error: getErrorMessage(err) })
    );
    return null;
  }
}
