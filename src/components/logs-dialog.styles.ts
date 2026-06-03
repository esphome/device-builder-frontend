import { css } from "lit";

import { MOBILE_BREAKPOINT } from "../styles/breakpoints.js";
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
  :host {
    /* Shared by the title part and the chip so the two can't drift. */
    --logs-mono-font: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
  }

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

  /* The primary header bar + title colour/size come from the shared
     primaryDialogHeaderStyles; the log title is the only monospace one.
     The title ellipsis + close-button-clearance now live in base-dialog,
     so a long /dev/cu… path can't overflow the header here either. */
  esphome-base-dialog::part(title) {
    font-family: var(--logs-mono-font);
  }
  esphome-base-dialog::part(body) {
    padding: 0;
    background: var(--term-bg);
    overflow: hidden;
  }

  /* Transport chip beside the title: OTA / serial path / Web Serial. */
  .source-chip {
    display: inline-block;
    vertical-align: middle;
    margin-left: var(--wa-space-s);
    /* Hold size so the name yields first; max-width is the last-resort clamp
       (full value stays on the title tooltip). */
    flex-shrink: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 1px 8px;
    border-radius: 999px;
    font-family: var(--logs-mono-font);
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-normal);
    color: var(--esphome-on-primary);
    background: color-mix(in srgb, var(--esphome-on-primary) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--esphome-on-primary) 32%, transparent);
    white-space: nowrap;
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
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    .expand-btn {
      display: none;
    }
  }
`;
