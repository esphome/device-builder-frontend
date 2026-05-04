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
       like rgb(255,255,0) wouldn't be visible at all.

       Yellow (33 / 93) maps to GitHub Light's warning amber
       (#9a6700) rather than Solarized's #b58900: the latter reads
       as "orange-y note" rather than a clear warning, and ESPHome
       emits ANSI yellow specifically for [WARNING] log lines.
       Going darker + slightly more orange makes warnings read as
       warnings even on the non-bold ANSI yellow path that
       PlatformIO uses for things like "Using Python 3.12.7 ..."
       informational notes. */
    /*
     * Tuned for WCAG AA contrast against --log-bg #f5f5f5 at
     * 12px (the log's body-text size). Pure-RGB legacy values
     * mostly fail that bar on a near-white surface — green
     * #2aa198 came in around 3:1, yellow #b58900 around 4:1,
     * VV #999 around 2.85:1. The values below sit in the 5:1+
     * range so the log reads as comfortable text rather than
     * "kind of visible if you squint".
     */
    --ansi-fg-30: #1f1f1f; /* black   */
    --ansi-fg-31: #9c1818; /* red     */
    --ansi-fg-32: #107a4e; /* green   */
    --ansi-fg-33: #7a5100; /* yellow  — darker amber for readable WARNING */
    --ansi-fg-34: #0451a5; /* blue    */
    --ansi-fg-35: #8b1a8b; /* magenta */
    --ansi-fg-36: #006b56; /* cyan    */
    --ansi-fg-37: #555555; /* white   — mid-grey on light surface;
                              "white" is paradoxical on a near-white
                              background, this is the contrast value */
    --ansi-fg-90: #6e6e6e; /* bright black   (VERBOSE log level) */
    --ansi-fg-91: #b30000; /* bright red     */
    --ansi-fg-92: #2d6a1f; /* bright green   */
    --ansi-fg-93: #7a5100; /* bright yellow  */
    --ansi-fg-94: #074d8c; /* bright blue    */
    --ansi-fg-95: #9c0e9c; /* bright magenta */
    --ansi-fg-96: #056b8a; /* bright cyan    */
    --ansi-fg-97: #1a1a1a; /* bright white   — paradoxical on light
                              surface; renders as near-black so the
                              "high-emphasis" semantic survives */

    /* Background (codes 40-47 + bright 100-107). Saturated by
       intent: ANSI bg highlights are visual flags, not body text
       — keeping them bright preserves the highlight effect that
       the legacy dashboard provides.

       Two cases need adjustment for the light surface, vs the
       legacy palette they otherwise mirror:

       - 40 (black) is a mid-tone #555 rather than pure #000.
         The renderer doesn't auto-pick a contrasting fg for
         bg-only spans, so the inherited --log-fg #1f1f1f
         text needs visible space against the bg. Pure #000
         left dark text on darker bg — barely readable. #555
         keeps the "this is a dark highlight" semantic while
         giving the inherited fg enough contrast to be readable.
       - 47 / 107 (white / bright white) are mapped to neutral
         greys instead of pure white. #ffffff against the
         #f5f5f5 log surface is barely distinguishable from
         "no highlight at all", which would silently swallow
         the highlight. Greys preserve the visual flag. */
    --ansi-bg-40: #555555; /* black   — mid-grey so the inherited
                                     --log-fg #1f1f1f text stays
                                     readable on a bg-only span */
    --ansi-bg-41: rgb(255, 0, 0); /* red     */
    --ansi-bg-42: rgb(0, 255, 0); /* green   */
    --ansi-bg-43: rgb(255, 255, 0); /* yellow  */
    --ansi-bg-44: rgb(0, 0, 255); /* blue    */
    --ansi-bg-45: rgb(255, 0, 255); /* magenta */
    --ansi-bg-46: rgb(0, 255, 255); /* cyan    */
    --ansi-bg-47: #bbbbbb; /* white   — light grey, would be
                                     invisible against the #f5f5f5
                                     log surface as pure white */
    --ansi-bg-100: rgb(128, 128, 128); /* bright black   */
    --ansi-bg-101: rgb(255, 0, 0); /* bright red     */
    --ansi-bg-102: rgb(0, 255, 0); /* bright green   */
    --ansi-bg-103: rgb(255, 255, 0); /* bright yellow  */
    --ansi-bg-104: rgb(0, 0, 255); /* bright blue    */
    --ansi-bg-105: rgb(255, 0, 255); /* bright magenta */
    --ansi-bg-106: rgb(0, 255, 255); /* bright cyan    */
    --ansi-bg-107: #d0d0d0; /* bright white  — same reason as 47 */

    /* VERY_VERBOSE: a touch lighter than VERBOSE (#6e6e6e) but
       still in the contrast-passing range against #f5f5f5 (~4:1).
       The previous #999 dropped to ~2.85:1, below WCAG AA, which
       made VV illegible at the 12px log size. Distinct from V
       without becoming noise text. */
    --log-fg-very-verbose: #7e7e7e;
  }
`;
