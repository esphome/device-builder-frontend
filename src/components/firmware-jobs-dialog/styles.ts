import { css } from "lit";

export const firmwareJobsDialogStyles = css`
  esphome-base-dialog {
    --width: min(620px, 95vw);
  }

  /* Primary header bar + flush 40x40 close button come from the shared
     primaryDialogHeaderStyles fragment + esphome-base-dialog. */

  esphome-base-dialog::part(footer) {
    display: none;
  }

  esphome-base-dialog::part(body) {
    padding: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    padding: var(--wa-space-s) var(--wa-space-m);
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-default);
  }

  .toolbar .spacer {
    flex: 1;
  }

  .tool-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: var(--wa-border-radius-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-default);
    font-family: inherit;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
    cursor: pointer;
    transition:
      background 0.1s,
      border-color 0.1s,
      color 0.1s;
  }

  .tool-btn:hover {
    background: var(--wa-color-surface-lowered);
    border-color: var(--wa-color-text-quiet);
  }

  .tool-btn wa-icon {
    font-size: 16px;
  }

  .tool-btn--ghost {
    background: transparent;
    border-color: transparent;
    color: var(--wa-color-text-quiet);
  }

  .tool-btn--ghost:hover {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
  }

  .jobs {
    /* Horizontal inset matches the toolbar's left/right padding
       (var(--wa-space-m)) so each row's hover/focus background lines
       up with the "Reset build environment" / "Clear history" buttons
       sitting directly above. Top stays tight so the first row hugs
       the toolbar separator; small bottom padding keeps the last row
       off the dialog edge. */
    padding: var(--wa-space-2xs) var(--wa-space-m) var(--wa-space-xs);
    max-height: 60vh;
    overflow-y: auto;
  }
`;
