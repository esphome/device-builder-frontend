import { html } from "lit";

import type { WebPlatform } from "../web-platform.js";

import "./esphome-web-rtl-ambz-card.js";

/** RTL8710B (AmebaZ). Its modules sit behind generic UART adapters, so no port claims it. */
export const rtlAmbzWebMode: WebPlatform<"ambz"> = {
  mode: "ambz",
  logo: "rtl8710b.svg",
  labelKey: "web.header.mode_ambz",
  introKey: "web.intro.body_ambz",
  renderCard: () => html`<esphome-web-rtl-ambz-card></esphome-web-rtl-ambz-card>`,
};
