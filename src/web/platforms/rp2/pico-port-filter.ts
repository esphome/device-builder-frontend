import toast from "sonner-js";

import type { LocalizeFunc } from "../../../common/localize.js";
import { isRp2CdcPort, RASPBERRY_PI_USB_VID } from "../../../platforms/rp2/index.js";
import { getErrorMessage } from "../../../util/error-message.js";
import { PortNotAcceptedError, requestSerialPort } from "../../../util/web-serial.js";

/**
 * Web Serial port filters for a Raspberry Pi Pico running ESPHome: any
 * Raspberry Pi USB device, the same boards the site's Pico detection claims.
 * A filter can't exclude a product id, so the picker also lists Raspberry Pi
 * debug probes; pass ``isRp2CdcPort`` as the pick's ``accept`` to turn them away.
 */
export const picoPortFilters: SerialPortRequestOptions["filters"] = [
  { usbVendorId: RASPBERRY_PI_USB_VID },
];

/**
 * The Pico's pick: the filters above plus the check that turns a debug probe
 * away. Spread into ``touchIntoBootloader``; ``pickPicoPort`` uses it too.
 */
export const PICO_PICK = { filters: picoPortFilters, accept: isRp2CdcPort };

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
