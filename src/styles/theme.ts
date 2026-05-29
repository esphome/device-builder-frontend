/**
 * Web Awesome theme setup for ESPHome.
 *
 * Imports the individual WA theme layers (CSS-in-JS modules) and composes
 * them into a single CSSStyleSheet that can be adopted by the document.
 *
 * The WA `.css.js` files use `@import` directives internally that don't
 * resolve when injected as `<style>` tags. So we import each layer's
 * standalone module and compose them ourselves in the correct @layer order.
 *
 * Layer order (from layers.css):
 *   wa-native, wa-utilities, wa-color-palette, wa-color-variant,
 *   wa-theme, wa-theme-dimension, wa-theme-overrides
 */
import type { CSSResult } from "lit";

// 1. Layer order declaration
import layersStyles from "@home-assistant/webawesome/dist/styles/layers.css.js";

// 2. Color palettes — base (gte-60 / -on helpers) + default palette (raw hex values)
import basePaletteStyles from "@home-assistant/webawesome/dist/styles/color/palettes/base.css.js";
import defaultPaletteStyles from "@home-assistant/webawesome/dist/styles/color/palettes/default.css.js";

// 3. Color variants — semantic mapping (brand→blue, neutral→gray, etc.)
import brandVariantStyles from "@home-assistant/webawesome/dist/styles/color/variants/brand.css.js";
import dangerVariantStyles from "@home-assistant/webawesome/dist/styles/color/variants/danger.css.js";
import neutralVariantStyles from "@home-assistant/webawesome/dist/styles/color/variants/neutral.css.js";
import successVariantStyles from "@home-assistant/webawesome/dist/styles/color/variants/success.css.js";
import warningVariantStyles from "@home-assistant/webawesome/dist/styles/color/variants/warning.css.js";

// 4. Theme — light/dark mode tokens, typography, spacing, forms, etc.
import defaultThemeStyles from "@home-assistant/webawesome/dist/styles/themes/default.css.js";

// 5. Native HTML element styles (resets, base element styling)
import nativeStyles from "@home-assistant/webawesome/dist/styles/native.css.js";

// 6. Utilities — scroll lock
import scrollLockStyles from "@home-assistant/webawesome/dist/styles/utilities/scroll-lock.css.js";

/**
 * All WA theme CSS layers in the correct cascade order.
 *
 * Each module exports a Lit `css` tagged template (CSSResult) with its
 * CSS text. We extract the `.cssText` and combine them.
 */
export const waThemeLayers: CSSResult[] = [
  // Layer declaration must come first
  layersStyles,

  // Color foundation
  basePaletteStyles,
  defaultPaletteStyles,

  // Semantic color variants
  brandVariantStyles,
  neutralVariantStyles,
  successVariantStyles,
  warningVariantStyles,
  dangerVariantStyles,

  // Theme tokens (light/dark, typography, spacing, forms, etc.)
  defaultThemeStyles,

  // Native HTML element styling
  nativeStyles,

  // Utilities
  scrollLockStyles,
];

/**
 * Regex to match CSS @import directives that don't resolve when
 * injected as <style> elements. We import each layer individually
 * as JS modules, so these @import lines are redundant and would
 * cause 404 errors in the browser.
 */
const CSS_IMPORT_REGEX = /@import\s+(?:url\()?["'][^"']+["']\)?;?\n?/g;

/**
 * Get the combined CSS text from all WA theme layers,
 * stripping any @import directives that don't resolve at runtime.
 */
export function getWaThemeCssText(): string {
  return waThemeLayers
    .map((layer) => layer.cssText.replace(CSS_IMPORT_REGEX, ""))
    .join("\n");
}
