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

    /* Foreground (codes 30-37 + bright 90-97). */
    --ansi-fg-30: #c0c0c0;
    --ansi-fg-31: #f44747;
    --ansi-fg-32: #6a9955;
    --ansi-fg-33: #dcdcaa;
    --ansi-fg-34: #569cd6;
    --ansi-fg-35: #c586c0;
    --ansi-fg-36: #4ec9b0;
    --ansi-fg-37: #d4d4d4;
    --ansi-fg-90: #808080;
    --ansi-fg-91: #f44747;
    --ansi-fg-92: #6a9955;
    --ansi-fg-93: #dcdcaa;
    --ansi-fg-94: #569cd6;
    --ansi-fg-95: #c586c0;
    --ansi-fg-96: #4ec9b0;
    --ansi-fg-97: #ffffff;

    /* Background (codes 40-47 + bright 100-107). */
    --ansi-bg-40: #1e1e1e;
    --ansi-bg-41: #f44747;
    --ansi-bg-42: #6a9955;
    --ansi-bg-43: #dcdcaa;
    --ansi-bg-44: #569cd6;
    --ansi-bg-45: #c586c0;
    --ansi-bg-46: #4ec9b0;
    --ansi-bg-47: #d4d4d4;
    --ansi-bg-100: #808080;
    --ansi-bg-101: #f44747;
    --ansi-bg-102: #6a9955;
    --ansi-bg-103: #dcdcaa;
    --ansi-bg-104: #569cd6;
    --ansi-bg-105: #c586c0;
    --ansi-bg-106: #4ec9b0;
    --ansi-bg-107: #ffffff;

    /* ESPHome VERY_VERBOSE log level — slightly dimmer than VERBOSE
       (90 gray) so the two are visually distinguishable. */
    --log-fg-very-verbose: #666666;
  }
`;
