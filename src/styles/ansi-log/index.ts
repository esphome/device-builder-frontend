/**
 * ANSI log themes — barrel re-export.
 *
 * Each sibling module exports one theme's palette as a
 * `CSSResult` keyed by a `:host` selector (or `:host([attr])`
 * for non-default themes). The component spreads `ansiLogThemes`
 * into its `static styles` array so the cascade picks the right
 * palette based on which attribute is set on the host element.
 *
 * Adding a new theme:
 *   1. Drop a new `<theme>.ts` next to this file. Use selector
 *      `:host([<theme>])`. Override the same `--ansi-fg-*` /
 *      `--ansi-bg-*` / `--log-fg-very-verbose` variables.
 *   2. Append it here.
 *   3. Add a property on the host component (mirrors the existing
 *      `light` boolean) so callers can request it.
 *
 * The dark palette MUST stay first — it's the baseline `:host`
 * selector that other themes override.
 */

import { ansiLogThemeDark } from "./dark.js";
import { ansiLogThemeLight } from "./light.js";

export const ansiLogThemes = [ansiLogThemeDark, ansiLogThemeLight];
