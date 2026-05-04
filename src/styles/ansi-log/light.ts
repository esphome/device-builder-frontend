/**
 * ANSI log palette — light frontend theme.
 *
 * Mirrors esphome/dashboard's `coloredConsoleStyles` (the legacy
 * `esphome dashboard` install/log window) — bright pure-RGB
 * values. Even though we render the log on a dark surface in
 * every theme (see `./dark.ts`), switching to the legacy palette
 * when the rest of the app is in light mode makes the log match
 * what `esphome dashboard` users have been looking at for years.
 *
 * Selector is `:host([light])` so it overrides the dark defaults
 * from `./dark.ts` only when the host element has the `light`
 * attribute set.
 */

import { css } from "lit";

export const ansiLogThemeLight = css`
  :host([light]) {
    /* Foreground. */
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

    /* Background. */
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
