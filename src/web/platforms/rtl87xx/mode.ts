import { html } from "lit";

import type { WebPlatform } from "../web-platform.js";

import "./esphome-web-rtl-card.js";

/**
 * RTL8720C (AmebaZ2). Its kits sit behind generic UART bridges, so no port
 * claims it. The RTL8710B is a mode of its own (``ambz-mode.ts``).
 */
export const rtlWebMode: WebPlatform<"rtl"> = {
  mode: "rtl",
  logo: "rtl8720c.svg",
  labelKey: "web.header.mode_rtl",
  introKey: "web.intro.body_rtl",
  renderCard: () => html`<esphome-web-rtl-card></esphome-web-rtl-card>`,
};
