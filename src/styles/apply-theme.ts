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
applySonnerOverrides();
