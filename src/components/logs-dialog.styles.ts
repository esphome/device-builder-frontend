import { css } from "lit";

import { MOBILE_DIALOG_BREAKPOINT } from "../styles/dialog-mobile.js";

/**
 * Styles for <esphome-logs-dialog>. Extracted from the component
 * file to keep it under the repo's file-size cap (see README →
 * "Code structure policies"). The dialog pulls these in via its
 * ``static styles`` array alongside ``espHomeStyles``. Class names
 * map to the terminal chrome: the dark/light themed surface, the
 * toolbar buttons (start/stop/clear/download/expand), the
 * streaming indicator dot, and the back-to-install affordance.
 */
export const logsDialogStyles = css`
  :host {
    --term-bg: #1e1e1e;
    --term-bg-alt: #252526;
    --term-fg: #d4d4d4;
    --term-fg-muted: #808080;
    --term-border: #3c3c3c;
    --term-hover: #2a2d2e;
    --term-accent: #4ec9b0;
    --term-error: #f44747;
  }

  :host([light]) {
    --term-bg: #f5f5f5;
    --term-bg-alt: #e8e8e8;
    --term-fg: #1e1e1e;
    --term-fg-muted: #6e6e6e;
    --term-border: #d0d0d0;
    --term-hover: #dcdcdc;
    --term-accent: #0d8a6f;
    --term-error: #c02020;
  }

  esphome-base-dialog {
    /* Width history: 900 wrapped, 1100 still ~100px short, 1200
       still wrapped on retina / HiDPI screens where ESPHome's
       ANSI-coloured output reads at a slightly larger glyph and
       the timestamp + [C][module:NNN] prefix eats more
       horizontal real estate than expected. 1300 fits the
       common case end-to-end on a 13-inch laptop and leaves the
       expand button as the answer for long-tail lines
       (multi-component config dumps, stack traces) past ~150
       columns. min(..., 94vw) keeps the dialog from kissing the
       viewport edges on smaller screens. */
    --width: min(1300px, 94vw);
  }

  /* Expanded → "just give me logs": full viewport, the body fills
     the space between the slim title bar and the streaming/stop
     toolbar. height: 100% (with min-height: 0 so flex children
     can shrink) lets the dialog's intrinsic header/body/footer
     flex layout do the math, which avoids the calc(100dvh - X)
     guesswork that left ~200px of empty space under the toolbar.
     Same shape the mobile rule below already uses. */
  :host([expanded]) .logs-content {
    height: 100%;
    max-height: none;
    min-height: 0;
  }

  /* Match the device-editor's title bar (--esphome-primary
     background with --esphome-on-primary text) so the dialog
     reads as part of the dashboard chrome. The body stays
     terminal-themed — header colour was the only thing that
     looked unintentional against the dashboard's blue header
     bar. */
  esphome-base-dialog::part(header) {
    background: var(--esphome-primary);
    /* Right padding is 0 so the close button sits flush with the
       dialog's corner — the button is explicitly sized to a 40x40
       square below to give the X a comfortable hit target right
       where the user reaches for it. */
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

  /* Close-button styling is bundled by
     <esphome-base-dialog>; the shared
     dialogCloseButtonStyles sheet lives in
     src/styles/dialog-close-button.ts. */

  esphome-base-dialog::part(body) {
    padding: 0;
    background: var(--term-bg);
    overflow: hidden;
  }

  esphome-base-dialog::part(footer) {
    display: none;
  }

  .logs-content {
    display: flex;
    flex-direction: column;
    height: 60vh;
    min-height: 300px;
    max-height: 70vh;
    overflow: hidden;
  }

  esphome-ansi-log {
    flex: 1;
    min-height: 0;
    --log-height: 100%;
  }

  /* Override ansi-log border-radius inside the dialog */
  esphome-ansi-log::part(container) {
    border-radius: 0;
  }

  .terminal-toolbar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    padding: 6px var(--wa-space-m);
    background: var(--term-bg-alt);
    border-top: 1px solid var(--term-border);
  }

  .terminal-toolbar .spacer {
    flex: 1;
  }

  .term-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    font-family: "SF Mono", "Fira Code", monospace;
    cursor: pointer;
    border: 1px solid var(--term-border);
    transition:
      background 0.1s,
      border-color 0.1s;
  }

  .term-btn wa-icon {
    font-size: 14px;
  }

  .term-btn--ghost {
    background: transparent;
    color: var(--term-fg-muted);
  }

  .term-btn--ghost:hover {
    background: var(--term-hover);
    color: var(--term-fg);
    border-color: var(--term-fg-muted);
  }

  /* Tint the states toggle with the accent palette while the
     "show states" mode is on so the user can tell at a glance
     whether component state lines are flowing. Same palette as
     --start so it visually reads as "this is active". */
  .term-btn--ghost.is-active {
    background: color-mix(in srgb, var(--term-accent), transparent 85%);
    color: var(--term-accent);
    border-color: color-mix(in srgb, var(--term-accent), transparent 60%);
  }

  .term-btn--start {
    background: color-mix(in srgb, var(--term-accent), transparent 85%);
    color: var(--term-accent);
    border-color: color-mix(in srgb, var(--term-accent), transparent 60%);
  }

  .term-btn--start:hover {
    background: color-mix(in srgb, var(--term-accent), transparent 75%);
  }

  .term-btn--stop {
    background: color-mix(in srgb, var(--term-error), transparent 85%);
    color: var(--term-error);
    border-color: color-mix(in srgb, var(--term-error), transparent 60%);
  }

  .term-btn--stop:hover {
    background: color-mix(in srgb, var(--term-error), transparent 75%);
  }

  .streaming-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--term-accent);
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  /* Full-viewport rules — the same shape applies when the user
     hits expand on desktop AND on any mobile width. Placed last
     so same-specificity rules in this file win source-order
     against the desktop defaults. The :host esphome-base-dialog::part(dialog)
     selector lands at (0,1,2), beating both wa-dialog's internal
     .dialog (0,1,0) and the user-agent's dialog:modal (0,1,1)
     without needing !important. */
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

  @media (max-width: ${MOBILE_DIALOG_BREAKPOINT}px) {
    /* Full-screen ::part(dialog) comes from fullscreenMobileDialog in the
       static styles; these are the logs-specific companions. */
    .logs-content {
      height: 100%;
      max-height: none;
      min-height: 0;
    }

    .term-btn.expand-btn {
      display: none;
    }

    /* The desktop toolbar is a single non-wrapping row that pushes the
       controls right with a flex:1 spacer. On a phone the labelled
       buttons (States / Clear / Stop) ran off the right edge, so the
       Stop text was unreachable. Let the row wrap and drop the spacer
       so the buttons flow left-to-right onto a second line, keeping
       every label on-screen and tappable. */
    .terminal-toolbar {
      flex-wrap: wrap;
    }

    .terminal-toolbar .spacer {
      display: none;
    }
  }
`;
