/**
 * ANSI log palette — light frontend theme.
 *
 * Used when the host element has the `light` attribute set.
 * Gives the log a light surface to match a light-themed
 * dashboard (no big black box) AND a palette of darker, more
 * saturated colours that read against that light surface — the
 * legacy dashboard's pure-RGB values (`rgb(255,255,0)` yellow,
 * etc.) only work on dark backgrounds and were unreadable when
 * we tried them against `#f5f5f5` first.
 *
 * Foreground values are roughly the VS Code Light+ palette,
 * tweaked for contrast on the chosen surface. Background values
 * stay closer to the legacy bright RGB so an ANSI bg-highlighted
 * span (rare in ESPHome output but possible) still reads as a
 * highlight.
 */

import { css } from "lit";

export const ansiLogThemeLight = css`
  :host([light]) {
    /* Light log surface — matches the rest of the light-themed
       dashboard chrome. Just-off-white instead of pure white so
       it has a hint of paper texture and bright text doesn't
       glare. */
    --log-bg: #f5f5f5;
    --log-fg: #1f1f1f;
    --log-hover: rgba(0, 0, 0, 0.04);
    --log-placeholder: #888;

    /* Foreground (codes 30-37 + bright 90-97). All chosen to read
       as comfortable text against #f5f5f5 — pure-RGB primaries
       like rgb(255,255,0) wouldn't be visible at all. */
    --ansi-fg-30: #1f1f1f;
    --ansi-fg-31: #c01c28;
    --ansi-fg-32: #2aa198;
    --ansi-fg-33: #b58900;
    --ansi-fg-34: #0451a5;
    --ansi-fg-35: #a31515;
    --ansi-fg-36: #098658;
    --ansi-fg-37: #555555;
    --ansi-fg-90: #6e6e6e;
    --ansi-fg-91: #cd3131;
    --ansi-fg-92: #3d7a28;
    --ansi-fg-93: #af6700;
    --ansi-fg-94: #074d8c;
    --ansi-fg-95: #bc05bc;
    --ansi-fg-96: #0598bc;
    --ansi-fg-97: #1a1a1a;

    /* Background (codes 40-47 + bright 100-107). Saturated by
       intent: ANSI bg highlights are visual flags, not body text
       — keeping them bright preserves the highlight effect that
       the legacy dashboard provides. */
    --ansi-bg-40: #1f1f1f;
    --ansi-bg-41: rgb(255, 0, 0);
    --ansi-bg-42: rgb(0, 255, 0);
    --ansi-bg-43: rgb(255, 255, 0);
    --ansi-bg-44: rgb(0, 0, 255);
    --ansi-bg-45: rgb(255, 0, 255);
    --ansi-bg-46: rgb(0, 255, 255);
    --ansi-bg-47: rgb(255, 255, 255);
    --ansi-bg-100: rgb(128, 128, 128);
    --ansi-bg-101: rgb(255, 0, 0);
    --ansi-bg-102: rgb(0, 255, 0);
    --ansi-bg-103: rgb(255, 255, 0);
    --ansi-bg-104: rgb(0, 0, 255);
    --ansi-bg-105: rgb(255, 0, 255);
    --ansi-bg-106: rgb(0, 255, 255);
    --ansi-bg-107: rgb(255, 255, 255);

    /* VERY_VERBOSE: lighter grey than VERBOSE so it reads as
       "even less prominent" against the light surface (which on
       dark is achieved by going darker — same relative dim, just
       the other direction). */
    --log-fg-very-verbose: #999999;
  }
`;
