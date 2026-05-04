/**
 * ANSI log palette — theme-aware CSS variables.
 *
 * Imported by `esphome-ansi-log`'s static styles so the variable
 * definitions live next to the rest of the app's theming concerns
 * rather than buried inside one component file.
 *
 * Two palettes:
 *
 * - Default (`:host`) — the muted VS Code Dark+ flavour. Easy on
 *   the eyes against a dark log surface. Used when the host
 *   element doesn't have the `light` attribute set.
 * - Light (`:host([light])`) — the legacy ESPHome dashboard's
 *   brighter pure-RGB palette (`rgb(255,0,0)` red,
 *   `rgb(255,255,0)` yellow, etc.). Even though we render the log
 *   on a dark surface in both themes, switching to the legacy
 *   palette when the rest of the app is in light mode makes the
 *   install/log window match what `esphome dashboard` users have
 *   been looking at for years.
 *
 * The log surface itself stays dark on every frontend theme —
 * issue #145: muted yellow was invisible against the previous
 * `#f5f5f5` light-mode log background, and the legacy dashboard
 * keeps its log dark on every theme too.
 */

import { css } from "lit";

export const ansiLogTheme = css`
  :host {
    /* Log surface: dark in both themes, see file-level docstring. */
    --log-bg: #1e1e1e;
    --log-fg: #d4d4d4;
    --log-hover: rgba(255, 255, 255, 0.04);
    --log-placeholder: #666;

    /* Dark-theme ANSI foreground palette: VS Code Dark+ flavour. */
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

    /* Dark-theme ANSI background palette. */
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

    --log-fg-very-verbose: #666666;
  }

  :host([light]) {
    /* Legacy ESPHome dashboard palette: bright pure RGB on dark
       surface. Mirrors esphome/dashboard coloredConsoleStyles. */
    --ansi-fg-30: rgb(128, 128, 128);
    --ansi-fg-31: rgb(255, 0, 0);
    --ansi-fg-32: rgb(0, 255, 0);
    --ansi-fg-33: rgb(255, 255, 0);
    --ansi-fg-34: rgb(0, 0, 255);
    --ansi-fg-35: rgb(255, 0, 255);
    --ansi-fg-36: rgb(0, 255, 255);
    --ansi-fg-37: rgb(187, 187, 187);
    --ansi-fg-90: rgb(128, 128, 128);
    --ansi-fg-91: rgb(255, 0, 0);
    --ansi-fg-92: rgb(0, 255, 0);
    --ansi-fg-93: rgb(255, 255, 0);
    --ansi-fg-94: rgb(0, 0, 255);
    --ansi-fg-95: rgb(255, 0, 255);
    --ansi-fg-96: rgb(0, 255, 255);
    --ansi-fg-97: rgb(255, 255, 255);

    --ansi-bg-40: rgb(0, 0, 0);
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

    --log-fg-very-verbose: rgb(128, 128, 128);
  }
`;
