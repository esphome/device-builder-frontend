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

// Style sonner toast action buttons to use the brand color
function applySonnerOverrides(): void {
  const style = document.createElement("style");
  style.id = "sonner-overrides";
  style.textContent = `
    [data-sonner-toast] [data-button] {
      color: var(--esphome-primary, #0d8a6f) !important;
      font-weight: 600 !important;
    }
  `;
  document.head.appendChild(style);
}

// Execute immediately on import
applyWaTheme();
applySonnerOverrides();
