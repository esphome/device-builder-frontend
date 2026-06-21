/**
 * Applies the Web Awesome theme to the document.
 *
 * Injects the combined WA theme CSS into the document head as a `<style>`
 * element.
 *
 * The ESPHome brand color variant (wa-brand-cyan) is set statically
 * on the <html> element in index.html.
 *
 * This module should be imported once in the application entrypoint
 * before any WA components are rendered.
 */
import { getWaThemeCssText } from "./theme.js";

/**
 * Inject the WA theme CSS into the document `<head>`.
 *
 * We use a `<style>` element rather than constructable stylesheets
 * because the tokens need to be defined at the document level (`:root`)
 * where they cascade into WA component shadow DOMs.
 */
function applyWaTheme(): void {
  const style = document.createElement("style");
  style.id = "wa-theme";
  style.textContent = getWaThemeCssText();
  document.head.appendChild(style);
}

/**
 * Document-level theme bridges so the custom properties cascade into
 * every shadow root: `--esphome-svg-filter` inverts monochrome SVG
 * icons in dark mode (hue-rotate keeps tinted strokes), and the
 * `.wa-light` / `.wa-dark` blocks map WebAwesome's surface/text tokens
 * onto HA's (with fallbacks for esphome-desktop). The colour palette
 * and the brand `--wa-color-*` tokens live in index.html.
 */
function applyEspHomeTokens(): void {
  const style = document.createElement("style");
  style.id = "esphome-tokens";
  style.textContent = `
    :root {
      --esphome-svg-filter: none;
    }

    /* Surfaces and text — remap WebAwesome's surface/text tokens to
       HA's palette so the panel doesn't only have an HA-coloured
       accent on a WebAwesome-coloured page. HA's own variables are
       mode-aware (different values in html.dark blocks on HA's side),
       so when embedded they resolve correctly without our needing to
       detect mode. Standalone, the fallbacks below mirror HA's
       light/dark defaults exactly. */
    .wa-light {
      --wa-color-surface-default: var(--primary-background-color, #fafafa);
      --wa-color-surface-raised: var(--card-background-color, #ffffff);
      --wa-color-surface-lowered: var(--secondary-background-color, #e5e5e5);
      --wa-color-surface-border: var(--divider-color, rgba(0, 0, 0, 0.12));
      --wa-color-text-normal: var(--primary-text-color, #141414);
      --wa-color-text-quiet: var(--secondary-text-color, #5e5e5e);
    }
    .wa-dark {
      --esphome-svg-filter: invert(1) hue-rotate(180deg);
      --wa-color-surface-default: var(--primary-background-color, #111111);
      --wa-color-surface-raised: var(--card-background-color, #1c1c1c);
      --wa-color-surface-lowered: color-mix(in oklch, var(--primary-background-color, #111111) 50%, black);
      --wa-color-surface-border: var(--divider-color, rgba(225, 225, 225, 0.12));
      --wa-color-text-normal: var(--primary-text-color, #e1e1e1);
      --wa-color-text-quiet: var(--secondary-text-color, #9b9b9b);
    }
  `;
  document.head.appendChild(style);
}

/** sonner-js renders toasts inside a shadow root attached to a
 *  `<div data-sonner-toasters>` it lazily appends to <body>. Document-level
 *  styles can't reach in there, so we inject our overrides directly into the
 *  shadow tree as soon as it exists. */
function applySonnerOverrides(): void {
  const css = `
    [data-sonner-toast] [data-button] {
      background: var(--wa-color-brand-fill-loud) !important;
      color: var(--wa-color-brand-on-loud) !important;
      border: none !important;
      font-weight: 600 !important;
    }
    [data-sonner-toast] [data-button]:hover {
      background: color-mix(in srgb, var(--wa-color-brand-fill-loud), black 10%) !important;
    }
  `;

  const inject = (): boolean => {
    const host = document.querySelector("[data-sonner-toasters]") as HTMLElement | null;
    if (!host?.shadowRoot) return false;
    if (host.shadowRoot.querySelector("style[data-esphome-overrides]")) return true;
    const style = document.createElement("style");
    style.setAttribute("data-esphome-overrides", "");
    style.textContent = css;
    host.shadowRoot.appendChild(style);
    return true;
  };

  if (inject()) return;

  const observer = new MutationObserver(() => {
    if (inject()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Execute immediately on import
applyWaTheme();
applyEspHomeTokens();
applySonnerOverrides();
