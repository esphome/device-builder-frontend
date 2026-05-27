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
 * Inject ESPHome-specific theme bridges that need to live at the
 * document level so CSS custom properties cascade into every
 * shadow root.
 *
 * `--esphome-svg-filter` adapts monochrome SVG icons (the ESPHome
 * component-catalog illustrations) to dark mode: in light mode it
 * stays `none`, in dark mode it inverts colours (with a
 * complementary hue rotation so any colour-tinted strokes survive
 * the round trip). Components apply it via
 * `filter: var(--esphome-svg-filter)` on `img[src$=".svg"]`.
 *
 * The ``--wa-color-brand-*`` overrides remap WebAwesome's default
 * cyan brand palette to Home Assistant's primary palette when
 * embedded as an HA panel. ``--primary-color`` and friends are set
 * by HA's theme on the root; when the panel runs standalone those
 * variables are undefined and the fallback values (HA's current
 * ``--ha-color-primary-40`` = #009ac7, plus matching translucent
 * and white companions) keep the panel looking consistent with
 * HA's default theme anyway. (Note: HA used to resolve
 * ``--primary-color`` to the legacy Material Light Blue 500 value
 * ``#03a9f4`` — that's been retired upstream in favour of
 * ``#009ac7``.) Without this, the panel headers, primary buttons,
 * FAB, and active view-toggle pip burst in WebAwesome cyan, which
 * clashes hard against HA's blue sidebar and chrome.
 */
function applyEspHomeTokens(): void {
  const style = document.createElement("style");
  style.id = "esphome-tokens";
  style.textContent = `
    :root {
      --esphome-svg-filter: none;
      --wa-color-brand-fill-loud: var(--primary-color, #009fee);
      --wa-color-brand-on-loud: var(--text-primary-color, #ffffff);
      --wa-color-brand-fill-quiet: var(--state-active-color, rgba(0, 159, 238, 0.12));
      --wa-color-brand-on-quiet: var(--primary-color, #009fee);
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
      --wa-color-surface-lowered: var(--secondary-background-color, #282828);
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
      background: #009fee !important;
      color: #ffffff !important;
      border: none !important;
      font-weight: 600 !important;
    }
    [data-sonner-toast] [data-button]:hover {
      background: color-mix(in srgb, #009fee, black 10%) !important;
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
