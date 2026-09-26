import { html } from "lit";

import { ESPRESSIF_USB_VID } from "../../../platforms/esp/index.js";
import type { WebPlatform } from "../web-platform.js";

import "./esphome-web-esp-connect-card.js";

/** ESP32 / ESP8266, the default mode. */
export const espWebMode: WebPlatform<"esp"> = {
  mode: "esp",
  logo: "espressif.png",
  labelKey: "web.header.mode_esp",
  introKey: "web.intro.body_esp",
  renderCard: () => html`<esphome-web-esp-connect-card></esphome-web-esp-connect-card>`,
  // Only ESP has the Logs / Install / Prepare actions the hint points at.
  dashboardHints: true,
  // An Espressif native-USB device; a UART bridge could be anything.
  claimsPort: (port) => port.getInfo().usbVendorId === ESPRESSIF_USB_VID,
};
