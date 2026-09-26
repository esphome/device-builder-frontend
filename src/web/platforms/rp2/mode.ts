import { html } from "lit";

import { isRp2CdcPort } from "../../../platforms/rp2/index.js";
import type { WebPlatform } from "../web-platform.js";

import "./esphome-web-pico-connect-card.js";

/** Raspberry Pi Pico W. */
export const picoWebMode: WebPlatform<"pico"> = {
  mode: "pico",
  logo: "raspberry.png",
  labelKey: "web.header.mode_pico",
  introKey: "web.intro.body_pico",
  renderCard: () => html`<esphome-web-pico-connect-card></esphome-web-pico-connect-card>`,
  // A Pico's own CDC console, not a Raspberry Pi debug probe.
  claimsPort: isRp2CdcPort,
};
