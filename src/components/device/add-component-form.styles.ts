import { css } from "lit";

export const addComponentFormStyles = css`
  :host {
    display: block;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
  }

  .form-desc {
    margin: 0 0 var(--wa-space-m);
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
  }

  label {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  label .required {
    color: var(--esphome-error);
    margin-left: 2px;
  }

  input[type="text"],
  input[type="number"],
  select {
    width: 100%;
    padding: var(--wa-space-s) var(--wa-space-m);
    font-size: var(--wa-font-size-m);
    font-family: inherit;
    color: var(--wa-color-text-normal);
    background: var(--wa-color-surface-default);
    border: var(--wa-border-width-m) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    box-sizing: border-box;
    outline: none;
  }

  input:focus,
  select:focus {
    border-color: var(--esphome-primary);
  }

  input.invalid,
  select.invalid {
    border-color: var(--esphome-error);
  }

  input:disabled,
  select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .field-error {
    color: var(--esphome-error);
    font-size: var(--wa-font-size-xs);
  }

  .array-row {
    display: flex;
    gap: var(--wa-space-xs);
  }

  .array-row input {
    flex: 1;
  }

  .array-btn {
    background: none;
    border: var(--wa-border-width-m) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    padding: 0 var(--wa-space-s);
    cursor: pointer;
    font-family: inherit;
    color: var(--wa-color-text-normal);
  }

  .array-btn:hover:not(:disabled) {
    background: var(--wa-color-surface-lowered);
  }

  .array-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .yaml-preview {
    margin: 0;
    padding: var(--wa-space-s) var(--wa-space-m);
    background: var(--wa-color-surface-lowered);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    font-family: var(--wa-font-family-code, monospace);
    font-size: var(--wa-font-size-xs);
    white-space: pre;
    overflow-x: auto;
    color: var(--wa-color-text-normal);
  }

  .toggle-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--esphome-primary);
    cursor: pointer;
    font-size: var(--wa-font-size-xs);
    text-decoration: underline;
    align-self: flex-start;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--wa-space-s);
    margin-top: var(--wa-space-m);
  }

  .btn {
    padding: var(--wa-space-s) var(--wa-space-l);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    border: var(--wa-border-width-m) solid transparent;
  }

  .btn-secondary {
    background: none;
    border-color: var(--wa-color-surface-border);
    color: var(--wa-color-text-normal);
  }

  .btn-primary {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    color: var(--esphome-error);
    font-size: var(--wa-font-size-s);
  }
`;
