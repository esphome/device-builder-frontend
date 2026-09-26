import { html } from "lit";

import type { WebPlatform } from "../web-platform.js";

import "./esphome-web-nrf-card.js";

/** nRF52 boards running ESPHome (Zephyr). */
export const nrfWebMode: WebPlatform<"nrf"> = {
  mode: "nrf",
  logo: "nordic.svg",
  labelKey: "web.header.mode_nrf",
  introKey: "web.intro.body_nrf",
  renderCard: () => html`<esphome-web-nrf-card></esphome-web-nrf-card>`,
  flowSwitch: {
    family: "nrf52",
    messageKey: "web.flow_switch.nrf",
    actionKey: "web.flow_switch.action_nrf",
  },
};
