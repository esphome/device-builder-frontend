import type { LocalizeFunc } from "../../common/localize.js";
import { getErrorMessage } from "../../util/error-message.js";
import { notifyError } from "../../util/notify.js";
import { PortNotAcceptedError, requestSerialPort } from "../../util/web-serial.js";
import { RP2_SERIAL_PICK } from "./web-usb.js";

/**
 * Pick a Pico's own CDC port (``RP2_SERIAL_PICK``), from a click. Null when
 * the picker was dismissed or the pick failed; a debug probe picked by
 * mistake, or any other failure (``failKey``, given the error as
 * ``{error}``), is toasted here.
 */
export async function pickRp2CdcPort(
  localize: LocalizeFunc,
  failKey: string
): Promise<SerialPort | null> {
  try {
    return await requestSerialPort(
      { filters: RP2_SERIAL_PICK.filters },
      RP2_SERIAL_PICK.accept
    );
  } catch (err) {
    notifyError(
      err instanceof PortNotAcceptedError
        ? localize("firmware.rp2_not_a_pico")
        : localize(failKey, { error: getErrorMessage(err) })
    );
    return null;
  }
}
