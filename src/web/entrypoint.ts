/**
 * ESPHome Web entrypoint.
 *
 * The standalone, backend-free variant of the dashboard (deployed to
 * web.esphome.io). Everything runs in the browser over Web Serial — there is
 * no WebSocket, no auth, no server. It reuses the dashboard's design system,
 * Web Serial engine, and localization, then boots its own app shell.
 *
 * Import order matters: the theme must be applied before Web Awesome
 * components render so the CSS custom-property tokens are available.
 */
import "urlpattern-polyfill";

// Polyfill crypto.randomUUID for non-secure contexts. web.esphome.io is
// always https (Web Serial needs a secure context anyway), so this is purely
// defensive for local http testing.
if (typeof crypto !== "undefined" && !crypto.randomUUID) {
  crypto.randomUUID = () =>
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(
        16
      )
    ) as `${string}-${string}-${string}-${string}-${string}`;
}

import "../styles/apply-theme.js";
import "./esphome-web-app.js";

import { installWaTooltipTouchSuppression } from "../util/wa-tooltip-touch-suppression.js";

// Same guard the dashboard entrypoint installs: without it a tap's emulated
// mouseover shows a wa-tooltip after the click already opened the dialog or
// menu, with nothing to ever hide it.
installWaTooltipTouchSuppression();
