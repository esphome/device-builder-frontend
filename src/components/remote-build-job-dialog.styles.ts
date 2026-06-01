import { css } from "lit";

/**
 * Styles for <esphome-remote-build-job-dialog>. Extracted from the
 * component file to keep it under the repo's file-size cap (see
 * README → "Code structure policies"). The dialog pulls these in
 * via its ``static styles`` array alongside ``espHomeStyles``,
 * ``inputStyles``, and ``jobStatusPillStyles``. Class names map to
 * the input fields, the per-row Cancel button, and the offload-job
 * list with its expandable log bodies.
 */
export const remoteBuildJobDialogStyles = css`
  esphome-base-dialog {
    --width: 560px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    margin-bottom: var(--wa-space-m);
  }

  .field-error {
    color: var(--esphome-error);
    font-size: var(--wa-font-size-s);
    margin-top: var(--wa-space-xs);
  }

  /* Destructive variant for the per-row Cancel-this-job
     button. Mirrors confirm-dialog's destructive btn tint
     without dragging the whole confirm-dialog style block in.
     The other two buttons in this dialog (.btn-primary /
     .btn-secondary) inherit browser-default chrome. */
  .btn-danger {
    background: var(--esphome-error);
    color: var(--esphome-on-primary);
    border: var(--wa-border-width-s) solid var(--esphome-error);
    border-radius: var(--wa-border-radius-m);
    padding: 0 var(--wa-space-m);
    min-height: var(--wa-form-control-height);
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    cursor: pointer;
  }

  .btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--esphome-error), black 10%);
    border-color: color-mix(in srgb, var(--esphome-error), black 10%);
  }

  .btn-danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--wa-space-s);
    margin-top: var(--wa-space-m);
  }

  .row-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--wa-space-s);
    margin-top: var(--wa-space-s);
  }

  .empty {
    color: var(--wa-color-neutral-500);
    margin: var(--wa-space-m) 0;
  }

  .job-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
  }

  .job-row {
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-lowered);
  }

  .job-summary {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    width: 100%;
    padding: var(--wa-space-s) var(--wa-space-m);
    background: transparent;
    border: 0;
    border-radius: var(--wa-border-radius-m);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    color: inherit;
  }

  .job-summary:hover {
    background: var(--wa-color-surface-border);
  }

  .job-summary-text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    gap: 2px;
  }

  .job-receiver {
    font-weight: var(--wa-font-weight-semibold);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .job-meta-line {
    color: var(--wa-color-neutral-500);
    font-size: var(--wa-font-size-s);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    color: var(--wa-color-neutral-500);
    font-size: var(--wa-font-size-s);
  }

  .job-body {
    padding: 0 var(--wa-space-m) var(--wa-space-m);
    border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .logs-container {
    height: 320px;
    overflow: hidden;
    margin-top: var(--wa-space-s);
  }

  esphome-ansi-log {
    height: 100%;
  }

  .status-line {
    margin: var(--wa-space-l) 0;
    color: var(--wa-color-neutral-500);
  }
`;
