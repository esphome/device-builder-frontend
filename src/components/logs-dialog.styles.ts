import { css } from "lit";

import { MOBILE_DIALOG_BREAKPOINT } from "../styles/dialog-mobile.js";
import { fillTerminal } from "./process-terminal/process-terminal.styles.js";

/**
 * Styles for <esphome-logs-dialog>. The terminal surface itself (log output,
 * toolbar layout, term buttons, streaming dot) is rendered by the shared
 * <esphome-process-terminal>; what remains here is the dialog chrome (header /
 * body theming) and the expand / mobile full-viewport behavior, which drives
 * the component's height through its --process-terminal-* custom properties.
 * The --term-* tokens and .term-btn rules for the slotted toolbar buttons come
 * from the shared termTokens / termButtonStyles in the component's styles.
 */
export const logsDialogStyles = css`
  esphome-base-dialog {
    /* Width history: 900 wrapped, 1100 still ~100px short, 1200 still wrapped
       on retina / HiDPI screens where ESPHome's ANSI-coloured output reads at
       a slightly larger glyph and the timestamp + [C][module:NNN] prefix eats
       more horizontal real estate than expected. 1300 fits the common case
       end-to-end on a 13-inch laptop and leaves the expand button as the
       answer for long-tail lines past ~150 columns. min(..., 94vw) keeps the
       dialog off the viewport edges on smaller screens. */
    --width: min(1300px, 94vw);
  }

  /* Match the device-editor's title bar so the dialog reads as part of the
     dashboard chrome; the body stays terminal-themed. */
  esphome-base-dialog::part(header) {
    background: var(--esphome-primary);
    /* Right padding 0 so the close button sits flush with the corner. */
    padding: 0 0 0 var(--wa-space-m);
    height: 40px;
    box-sizing: border-box;
  }
  esphome-base-dialog::part(title) {
    color: var(--esphome-on-primary);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
  }
  esphome-base-dialog::part(body) {
    padding: 0;
    background: var(--term-bg);
    overflow: hidden;
  }
  esphome-base-dialog::part(footer) {
    display: none;
  }

  /* Expanded → "just give me logs": full viewport, the terminal fills the
     space between the slim title bar and the toolbar. The component fills the
     dialog body (height: 100%) and its content stretches via the height vars. */
  :host([expanded]) esphome-process-terminal,
  esphome-process-terminal {
    display: block;
  }
  :host([expanded]) ${fillTerminal}

  /* Full-viewport rules — same shape on desktop expand AND any mobile width.
     Placed last so same-specificity rules win source-order. The
     :host esphome-base-dialog::part(dialog) selector lands at (0,1,2), beating
     wa-dialog's internal .dialog (0,1,0) and the UA's dialog:modal (0,1,1). */
  :host([expanded]) esphome-base-dialog::part(dialog) {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    border-radius: 0;
  }

  /* Full-screen sheet + terminal-fill on mobile come from
     fullscreenMobileDialog + fillTerminalOnMobile in the static styles; only
     the logs-specific expand-button hide remains here. */
  @media (max-width: ${MOBILE_DIALOG_BREAKPOINT}px) {
    .expand-btn {
      display: none;
    }
  }
`;
