import { html } from "lit";

import { isNrfAppCdcPort } from "../../../platforms/nrf52/index.js";
import type { WebPlatform } from "../web-platform.js";

import "./esphome-web-nrf-card.js";

// An nRF52 running ESPHome is a Zephyr USB device (ESPHome's only Zephyr
// platform), and Nordic's own id is nRF52 outright. Adafruit and Seeed also
// ship RP2040 / ESP32-S3 / SAMD boards under their vendor ids, so only their
// known nRF52840 products count (the bootloader's ids, and the application
// ids other firmwares use).
const NORDIC_USB_VID = 0x1915;
const NRF52_USB_IDS = new Set([
  // Adafruit: Feather nRF52840 Express, Feather nRF52840 Sense, ItsyBitsy
  // nRF52840, CLUE, Circuit Playground Bluefruit, LED Glasses driver.
  0x239a_8029, 0x239a_0029, 0x239a_8087, 0x239a_0087, 0x239a_8051, 0x239a_0051,
  0x239a_8071, 0x239a_0071, 0x239a_8045, 0x239a_0045, 0x239a_810d, 0x239a_010d,
  // Seeed: XIAO nRF52840 and XIAO nRF52840 Sense.
  0x2886_8044, 0x2886_0044, 0x2886_8045, 0x2886_0045,
]);

function isNrf52Port(port: SerialPort): boolean {
  if (isNrfAppCdcPort(port)) return true;
  const { usbVendorId, usbProductId } = port.getInfo();
  if (usbVendorId === NORDIC_USB_VID) return true;
  if (usbVendorId === undefined || usbProductId === undefined) return false;
  return NRF52_USB_IDS.has(usbVendorId * 0x1_0000 + usbProductId);
}

/** nRF52 boards running ESPHome (Zephyr). */
export const nrfWebMode: WebPlatform<"nrf"> = {
  mode: "nrf",
  logo: "nordic.svg",
  labelKey: "web.header.mode_nrf",
  introKey: "web.intro.body_nrf",
  renderCard: () => html`<esphome-web-nrf-card></esphome-web-nrf-card>`,
  flowSwitch: {
    claimsPort: isNrf52Port,
    messageKey: "web.flow_switch.nrf",
    actionKey: "web.flow_switch.action_nrf",
  },
};
