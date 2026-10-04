import { html } from "lit";

import type { WebPlatform } from "../web-platform.js";

import "./esphome-web-ln-card.js";

/** Lightning LN882H. Its modules sit behind generic UART adapters, so no port claims it. */
export const lnWebMode: WebPlatform<"ln"> = {
  mode: "ln",
  logo: "ln882x.svg",
  labelKey: "web.header.mode_ln",
  introKey: "web.intro.body_ln",
  renderCard: () => html`<esphome-web-ln-card></esphome-web-ln-card>`,
};
