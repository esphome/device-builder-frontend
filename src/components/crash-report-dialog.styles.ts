import { css } from "lit";

/**
 * Styles for <esphome-crash-report-dialog>: the collecting spinner, the
 * what-is-included summary list, and the two required fields with their
 * notes and warnings. Dialog chrome and the shared .btn shapes come from
 * modalDialogStyles; only the confirm button's colour is set here.
 */
export const crashReportDialogStyles = css`
  esphome-base-dialog {
    --width: 480px;
  }

  .collecting {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-m) 0;
    color: var(--wa-color-text-quiet);
  }

  .hint {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
    margin: 0 0 var(--wa-space-s);
  }

  .describe-required {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-warning-fill-loud, orange);
    margin: 0 0 var(--wa-space-s);
  }

  .describe-label {
    display: block;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    margin: 0 0 var(--wa-space-2xs);
  }

  .describe-input {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font: inherit;
    font-size: var(--wa-font-size-s);
    padding: var(--wa-space-xs);
    border-radius: var(--wa-border-radius-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-normal);
    margin: 0 0 var(--wa-space-2xs);
  }

  .describe-note {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    margin: 0 0 var(--wa-space-m);
  }

  /* Primary-CTA colour only; shape and the disabled state come from
         modalDialogStyles' shared .btn / .btn:disabled. */
  .btn--confirm {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .btn--confirm:hover:not(:disabled) {
    background: var(--esphome-primary-hover);
  }
`;
