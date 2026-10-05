import { html } from "lit";

import type { WebPlatform } from "../web-platform.js";

import "./esphome-web-rtl-card.js";

/** RTL87xx (RTL8720C, RTL8710B): behind generic UART bridges, so no port claims it. */
export const rtlWebMode: WebPlatform<"rtl"> = {
  mode: "rtl",
  logo: "rtl8720c.svg",
  labelKey: "web.header.mode_rtl",
  introKey: "web.intro.body_rtl",
  renderCard: () => html`<esphome-web-rtl-card></esphome-web-rtl-card>`,
};
