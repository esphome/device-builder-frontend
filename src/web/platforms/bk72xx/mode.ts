import { html } from "lit";

import type { WebPlatform } from "../web-platform.js";

import "../../dashboard/libretiny-card-element.js";
import { BK_CARD } from "./card.js";

/** Beken BK72xx. Its modules sit behind generic UART adapters, so no port claims it. */
export const bkWebMode: WebPlatform<"bk"> = {
  mode: "bk",
  logo: "bk72xx.svg",
  labelKey: "web.header.mode_bk",
  introKey: "web.intro.body_bk",
  renderCard: () =>
    html`<esphome-web-libretiny-card .card=${BK_CARD}></esphome-web-libretiny-card>`,
};
