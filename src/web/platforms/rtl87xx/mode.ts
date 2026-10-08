import { html } from "lit";

import type { WebPlatform } from "../web-platform.js";

import "../../dashboard/esphome-web-libretiny-card.js";
import { RTL_CARD } from "./card.js";

/** RTL87xx (RTL8720C, RTL8710B): behind generic UART bridges, so no port claims it. */
export const rtlWebMode: WebPlatform<"rtl"> = {
  mode: "rtl",
  logo: "rtl8720c.svg",
  labelKey: "web.header.mode_rtl",
  introKey: "web.intro.body_rtl",
  renderCard: () =>
    html`<esphome-web-libretiny-card .card=${RTL_CARD}></esphome-web-libretiny-card>`,
};
