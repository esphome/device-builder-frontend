import { css } from "lit";

export const pairBuildServerDialogStyles = css`
  esphome-base-dialog {
    --width: 500px;
  }

  esphome-base-dialog::part(header) {
    padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
  }

  esphome-base-dialog::part(title) {
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  esphome-base-dialog::part(body) {
    padding: 0 var(--wa-space-l);
  }

  esphome-base-dialog::part(footer) {
    display: none;
  }

  .description {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    padding-bottom: var(--wa-space-m);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
    padding-bottom: var(--wa-space-m);
  }

  .row {
    display: flex;
    gap: var(--wa-space-s);
    padding-bottom: var(--wa-space-m);
  }

  .row .field {
    flex: 1;
    padding-bottom: 0;
  }

  .field--port {
    flex: 0 0 110px;
  }

  label {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
  }

  .helper {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    margin-top: var(--wa-space-2xs);
  }

  .pin-card {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
    padding: var(--wa-space-m);
    margin-bottom: var(--wa-space-m);
    background: var(--wa-color-surface-default);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
  }

  .pin-card-label {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
  }

  .pin-card code {
    font-family: var(--wa-font-family-mono, monospace);
    font-size: var(--wa-font-size-xs);
    word-break: break-all;
  }

  .pin-card-target {
    font-family: var(--wa-font-family-mono, monospace);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--wa-space-s);
    padding: var(--wa-space-m) 0 var(--wa-space-l);
  }

  .field-error {
    color: var(--esphome-error);
    font-size: var(--wa-font-size-xs);
    margin-top: var(--wa-space-2xs);
  }

  .step-error {
    color: var(--esphome-error);
    font-size: var(--wa-font-size-s);
    padding: var(--wa-space-s) 0;
  }

  .trust-warning {
    margin-bottom: var(--wa-space-m);
    padding: var(--wa-space-s) var(--wa-space-m);
    border-left: 3px solid var(--esphome-warning, #f59e0b);
    background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 90%);
    color: var(--wa-color-text-normal);
    font-size: var(--wa-font-size-s);
  }

  .sent-body {
    padding-bottom: var(--wa-space-m);
    font-size: var(--wa-font-size-s);
  }

  .sent-body code {
    font-family: var(--wa-font-family-mono, monospace);
    font-size: var(--wa-font-size-xs);
  }
`;
