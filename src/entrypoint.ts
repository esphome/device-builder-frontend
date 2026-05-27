/**
 * Application entrypoint.
 *
 * Imports polyfills, applies the Web Awesome theme to the document,
 * then loads the main app shell component which bootstraps everything else.
 *
 * Import order matters: the theme must be applied before WA components
 * render so that CSS custom property tokens are available.
 */
import "urlpattern-polyfill";

// Polyfill crypto.randomUUID for non-secure contexts (HTTP on non-localhost)
if (typeof crypto !== "undefined" && !crypto.randomUUID) {
  crypto.randomUUID = () =>
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(
        16
      )
    ) as `${string}-${string}-${string}-${string}-${string}`;
}

import { withBase } from "./util/base-path.js";

// Set the favicon href at runtime so it resolves under any mount
// point. A static ``href="/assets/..."`` would 404 under an HA
// ingress prefix; a document-relative ``href="assets/..."`` would
// resolve against the current route on a deep link (the SPA serves
// the same index.html for ``/device/<id>``, which would then look
// for ``/device/assets/...``).
const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (favicon) favicon.href = withBase("/assets/logo/esphome.svg");

import "./styles/apply-theme.js";
import "./components/app-shell.js";
