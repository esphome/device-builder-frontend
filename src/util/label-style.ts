/**
 * Visual styling for label chips.
 *
 * Labels carry an optional ``#rrggbb`` color picked by the user. We
 * render the chip background as the raw color and pick a contrasting
 * text color (black on light hues, white on dark) via a relative-
 * luminance heuristic so the chip stays readable on both light and
 * dark themes. The border is the same hue mixed 35% with transparent
 * so it tones the rim down without dragging in extra contrast tokens.
 * Labels without an explicit color fall back to a neutral surface
 * palette so the chip still reads as "a chip" (and not as accidentally-
 * themed default text).
 */

export interface LabelChipStyle {
  background: string;
  color: string;
  borderColor: string;
}

const NEUTRAL_STYLE: LabelChipStyle = {
  background: "var(--wa-color-surface-lowered)",
  color: "var(--wa-color-text-quiet)",
  borderColor: "var(--wa-color-surface-border)",
};

/** ``#rrggbb`` validator. The backend lower-cases on save, but a
 *  hand-edited sidecar could still surface uppercase or a malformed
 *  string — fall back to the neutral palette in that case rather
 *  than throwing. Shared with the COLOR field renderer, whose
 *  ``<input type="color">`` can represent exactly this form. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const isHexColor = (value: string): boolean => HEX_RE.test(value);

/** Pick the contrasting foreground for a hex color using a
 *  relative-luminance heuristic. The cutoff is biased toward
 *  darker text on mid-tone colors (matching GitHub's label
 *  treatment), so a saturated yellow / cyan reads dark text and a
 *  saturated blue / red reads white. */
function contrastingTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  // Coefficients are the Rec. 601 luma weights, not full WCAG
  // sRGB-linear luminance — close enough for chip-readability and
  // avoids the gamma-decode round trip that would otherwise hit
  // every chip every render.
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.6 ? "#1a1a1a" : "#ffffff";
}

export function labelChipStyle(color: string | null | undefined): LabelChipStyle {
  if (!color || !HEX_RE.test(color)) return NEUTRAL_STYLE;
  return {
    background: color,
    color: contrastingTextColor(color),
    borderColor: `color-mix(in srgb, ${color}, transparent 35%)`,
  };
}

/** Inline ``style`` string for a chip element. Lit's
 *  ``styleMap`` directive would do this too but most call sites
 *  here use plain attribute interpolation, so a flat string keeps
 *  the chip helper drop-in. */
export function labelChipStyleString(color: string | null | undefined): string {
  const s = labelChipStyle(color);
  return `background:${s.background};color:${s.color};border-color:${s.borderColor}`;
}

/** Curated swatch palette for the label-creation UI. Warm-leaning
 *  hues (reds / oranges / ambers / olives / earth tones / warm
 *  violet & magenta) plus a warm stone neutral — picked to feel
 *  cohesive against the dashboard's surface tokens on both light
 *  and dark themes without straying into neon territory. The
 *  contrasting-text heuristic in ``contrastingTextColor`` keeps
 *  every swatch readable as a chip fill. */
export const LABEL_COLOR_SWATCHES: readonly string[] = [
  "#dc2626", // red
  "#ea580c", // burnt orange
  "#f59e0b", // amber
  "#ca8a04", // mustard
  "#84cc16", // lime / olive
  "#a16207", // bronze
  "#9333ea", // warm violet
  "#db2777", // rose
  "#78716c", // warm stone
];
