import { RASPBERRY_PI_USB_VID } from "../../util/web-usb.js";

/**
 * Web Serial port filters that narrow the browser picker to Raspberry Pi Pico
 * boards running ESPHome (RP2040 USB CDC). Vendor 0x2E8A is Raspberry Pi;
 * the two product IDs are the Pico and Pico W CDC interfaces.
 */
export const picoPortFilters: SerialPortRequestOptions["filters"] = [
  {
    // Pico (RP2040)
    usbProductId: 0x000a,
    usbVendorId: RASPBERRY_PI_USB_VID,
  },
  {
    // Pico W (RP2040)
    usbProductId: 0xf00a,
    usbVendorId: RASPBERRY_PI_USB_VID,
  },
];
