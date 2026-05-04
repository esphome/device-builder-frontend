/**
 * ANSI log palette — dark frontend theme.
 *
 * The default palette, applied at the `:host` level so it kicks
 * in whenever the host element doesn't have a more specific
 * theme attribute (e.g. `light`) set. Values mirror VS Code's
 * Dark+ flavour: muted, easy on the eyes against a dark log
 * surface.
 *
 * Owns the dark-mode log surface variables (`--log-bg` etc.) as
 * the baseline. Other themes are free to override them — see
 * `./light.ts` which gives the log a light surface to match a
 * light-themed dashboard.
 *
 * Adding a new theme: copy this file as `<theme-name>.ts`,
 * change the selector to `:host([<theme-name>])`, override the
 * palette values, and add an entry to `index.ts`.
 */

import { css } from "lit";

export const ansiLogThemeDark = css`
  :host {
    /* Dark log surface — VS Code Dark+ flavour. */
    --log-bg: #1e1e1e;
    --log-fg: #d4d4d4;
    --log-hover: rgba(255, 255, 255, 0.04);
    --log-placeholder: #666;

    /* Foreground — ANSI SGR codes 30-37 (standard) + 90-97 (bright).
       Standard 8 colours emitted by \\x1b[30m ... \\x1b[37m,
       bright variants by \\x1b[90m ... \\x1b[97m. ESPHome's
       --dashboard formatter maps log levels to these:
         32 → INFO   31 → ERROR    33 → WARNING
         34 → DEBUG  36 → CONFIG   90 → VERBOSE */
    --ansi-fg-30: #c0c0c0; /* black   */
    --ansi-fg-31: #f44747; /* red     */
    --ansi-fg-32: #6a9955; /* green   */
    --ansi-fg-33: #dcdcaa; /* yellow  */
    --ansi-fg-34: #569cd6; /* blue    */
    --ansi-fg-35: #c586c0; /* magenta */
    --ansi-fg-36: #4ec9b0; /* cyan    */
    --ansi-fg-37: #d4d4d4; /* white   */
    --ansi-fg-90: #808080; /* bright black   (gray) */
    --ansi-fg-91: #f44747; /* bright red     */
    --ansi-fg-92: #6a9955; /* bright green   */
    --ansi-fg-93: #dcdcaa; /* bright yellow  */
    --ansi-fg-94: #569cd6; /* bright blue    */
    --ansi-fg-95: #c586c0; /* bright magenta */
    --ansi-fg-96: #4ec9b0; /* bright cyan    */
    --ansi-fg-97: #ffffff; /* bright white   */

    /* Background — codes 40-47 (standard) + 100-107 (bright).
       Same colour mapping as foreground but applied as the span
       background via \\x1b[4Nm / \\x1b[10Nm. ESPHome rarely
       emits these; included for completeness when output happens
       to carry them (e.g. PlatformIO highlights). */
    --ansi-bg-40: #1e1e1e; /* black   */
    --ansi-bg-41: #f44747; /* red     */
    --ansi-bg-42: #6a9955; /* green   */
    --ansi-bg-43: #dcdcaa; /* yellow  */
    --ansi-bg-44: #569cd6; /* blue    */
    --ansi-bg-45: #c586c0; /* magenta */
    --ansi-bg-46: #4ec9b0; /* cyan    */
    --ansi-bg-47: #d4d4d4; /* white   */
    --ansi-bg-100: #808080; /* bright black   */
    --ansi-bg-101: #f44747; /* bright red     */
    --ansi-bg-102: #6a9955; /* bright green   */
    --ansi-bg-103: #dcdcaa; /* bright yellow  */
    --ansi-bg-104: #569cd6; /* bright blue    */
    --ansi-bg-105: #c586c0; /* bright magenta */
    --ansi-bg-106: #4ec9b0; /* bright cyan    */
    --ansi-bg-107: #ffffff; /* bright white   */

    /* ESPHome VERY_VERBOSE log level — slightly dimmer than VERBOSE
       (90 gray) so the two are visually distinguishable. */
    --log-fg-very-verbose: #666666;
  }
`;
