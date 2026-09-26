import { isRp2CdcPort, RASPBERRY_PI_USB_VID } from "../../../platforms/rp2/index.js";

/**
 * Web Serial port filters for a Raspberry Pi Pico running ESPHome: any
 * Raspberry Pi USB device, the same boards the site's Pico detection claims.
 * A filter can't exclude a product id, so the picker also lists Raspberry Pi
 * debug probes; pass ``isPicoPort`` as the pick's ``accept`` to turn them away.
 */
export const picoPortFilters: SerialPortRequestOptions["filters"] = [
  { usbVendorId: RASPBERRY_PI_USB_VID },
];

/** A Pico's own CDC console, not a debug probe (Picoprobe, Debug Probe). */
export const isPicoPort = isRp2CdcPort;
