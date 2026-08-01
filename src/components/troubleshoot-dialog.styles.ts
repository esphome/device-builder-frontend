/** Styles for `troubleshoot-dialog.ts`, split out for file size. */
import { css } from "lit";

export const troubleshootDialogStyles = css`
  :host {
    display: contents;
  }

  esphome-base-dialog {
    --width: 520px;
  }

  .probe-rows {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    margin-bottom: var(--wa-space-m);
    padding: var(--wa-space-s);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-lowered);
    font-size: var(--wa-font-size-s);
  }

  .probe-row {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
  }

  .probe-row wa-icon {
    flex-shrink: 0;
    font-size: 16px;
  }

  .probe-row.ok wa-icon {
    color: var(--esphome-success, #2e7d32);
  }

  .probe-row.fail wa-icon {
    color: var(--esphome-error);
  }

  .probe-row.neutral wa-icon {
    color: var(--wa-color-text-quiet);
  }

  .checking {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
    margin-bottom: var(--wa-space-m);
  }

  .section {
    margin-bottom: var(--wa-space-m);
  }

  .section h3 {
    margin: 0 0 var(--wa-space-2xs);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
  }

  /* Deliberately quiet: the manual address is the last resort, so
         this must not read as the recommended action. */
  .drill {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--wa-color-text-quiet);
    font: inherit;
    font-size: var(--wa-font-size-xs);
    cursor: pointer;
  }

  .drill:hover {
    color: var(--wa-color-text-normal);
    text-decoration: underline;
  }

  .drill wa-icon {
    flex-shrink: 0;
    font-size: 14px;
  }

  .back-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--wa-space-2xs);
    border: none;
    background: transparent;
    color: var(--wa-color-text-normal);
    cursor: pointer;
    font-size: 20px;
  }

  .section p {
    margin: 0 0 var(--wa-space-s);
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
  }

  .section a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--wa-font-size-s);
    color: var(--esphome-primary);
  }

  .btn--remove {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .btn--remove:hover {
    background: var(--wa-color-surface-border);
  }

  .address-label {
    display: flex;
    align-items: baseline;
    gap: var(--wa-space-xs);
    margin: 0 0 var(--wa-space-2xs);
    font-size: var(--wa-font-size-s);
  }

  .address-label code {
    font-family: var(--wa-font-family-code, monospace);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
  }

  .address-label span {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  .address-form {
    display: flex;
    gap: var(--wa-space-xs);
  }

  .address-form input {
    flex: 1;
    padding: var(--wa-space-2xs) var(--wa-space-xs);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-normal);
    font: inherit;
    font-size: var(--wa-font-size-s);
  }

  .address-form input.invalid {
    border-color: var(--esphome-error);
  }

  .field-error {
    color: var(--esphome-error);
  }

  .btn--confirm {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .btn--confirm:hover {
    background: var(--esphome-primary-hover);
  }

  /* Out-specifies .section p so the banner keeps the warning tone. */
  .section p.warning-banner {
    color: var(--wa-color-warning-on-quiet, #6b4f00);
  }

  .saved-panel {
    display: flex;
    align-items: flex-start;
    gap: var(--wa-space-s);
    padding: var(--wa-space-m) 0;
  }

  .saved-panel wa-icon {
    flex-shrink: 0;
    font-size: 24px;
    color: var(--esphome-success, #2e7d32);
  }

  .section .saved-panel p {
    margin: 0;
    color: var(--wa-color-text-normal);
  }

  .snippet {
    margin: var(--wa-space-2xs) 0 0;
    padding: var(--wa-space-xs);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-lowered);
    font-family: var(--wa-font-family-code, monospace);
    font-size: var(--wa-font-size-xs);
    white-space: pre;
    overflow-x: auto;
  }
`;
