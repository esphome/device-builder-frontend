import { css } from "lit";

import { crashCalloutStyles } from "../../components/process-terminal/crash-callout.js";
import {
  fillTerminalOnMobile,
  termButtonStyles,
  termTokens,
} from "../../components/process-terminal/process-terminal.styles.js";
import { primaryDialogHeaderStyles } from "../../styles/dialog-header.js";

/**
 * Styles for <esphome-web-logs-dialog>: the brand-primary header bar,
 * the terminal tokens and buttons, and the dialog body dressed as the
 * terminal surface.
 */
export const webLogsDialogStyles = [
  // Brand-primary header bar, matching the builder's own logs dialog.
  primaryDialogHeaderStyles,
  termTokens,
  termButtonStyles,
  fillTerminalOnMobile,
  css`
    esphome-base-dialog {
      /* Wide enough for ESPHome's timestamp + [C][module:NNN] prefix plus a
           long message before wrapping (mirrors the builder's logs dialog). */
      --width: min(1300px, 94vw);
    }
    /* Dress the dialog body as the terminal surface: drop the default body
         padding so the terminal fills it edge-to-edge, and paint the body the
         terminal background so there's no seam behind the rounded corners. */
    esphome-base-dialog::part(body) {
      padding: 0;
      background: var(--term-bg);
      overflow: hidden;
    }
    esphome-process-terminal {
      display: block;
      /* Size the terminal's own flex column via its height variable, not the
           host's height: the internal .content defaults to 60vh, so forcing a
           taller host would leave a gap below the toolbar. */
      --process-terminal-height: min(70vh, 40rem);
      --process-terminal-max-height: min(70vh, 40rem);
    }
    .toolbar-slot {
      display: flex;
      gap: var(--wa-space-2xs);
      align-items: center;
    }
  `,
  crashCalloutStyles,
];
