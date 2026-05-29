import { css } from "lit";

export const firmwareInstallDialogStyles = css`
  :host {
    --term-bg: #1e1e1e;
    --term-fg: #d4d4d4;
    --term-border: #333;
    --term-success: #6a9955;
    --term-error: #f44747;
  }
  :host([light]) {
    --term-bg: #f5f5f5;
    --term-fg: #333;
    --term-border: #ddd;
    --term-success: #3d7a28;
    --term-error: #c72e2e;
  }

  esphome-base-dialog {
    --width: 520px;
  }
  :host([expanded]) esphome-base-dialog {
    --width: min(900px, 90vw);
  }

  /* Animate width on expand-toggle. Lives on ::part(dialog) because
     esphome-base-dialog is display: contents and has no layout box. */
  esphome-base-dialog::part(dialog) {
    transition: width 0.2s;
  }

  esphome-base-dialog::part(header) {
    background: var(--esphome-primary);
    padding: 0 var(--wa-space-m);
    height: 40px;
    box-sizing: border-box;
  }
  esphome-base-dialog::part(title) {
    color: var(--esphome-on-primary);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
  }
  esphome-base-dialog::part(body) {
    padding: var(--wa-space-l) var(--wa-space-xl);
  }
  esphome-base-dialog::part(footer) {
    display: none;
  }

  .status {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--wa-space-m);
    padding: var(--wa-space-l) 0;
  }

  .status wa-spinner {
    font-size: 36px;
    --indicator-color: var(--esphome-primary);
    --track-color: color-mix(in srgb, var(--esphome-primary), transparent 80%);
  }

  .status-icon {
    font-size: 42px;
  }
  .status-icon--success {
    color: var(--esphome-success);
  }
  .status-icon--error {
    color: var(--esphome-error);
  }

  .status-text {
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .status-detail {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    max-width: 380px;
    line-height: 1.5;
  }

  /* Reset-build-env suggestion — secondary hint, quieter than the red error. */
  .reset-suggestion {
    padding: var(--wa-space-s) var(--wa-space-m);
    margin: var(--wa-space-m) auto 0;
    max-width: 480px;
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-lowered);
    font-size: var(--wa-font-size-xs);
    line-height: 1.5;
    color: var(--wa-color-text-normal);
    text-align: center;
  }
  .reset-suggestion-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--esphome-primary);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .reset-suggestion-link:hover,
  .reset-suggestion-link:focus-visible {
    text-decoration-thickness: 2px;
    outline: none;
  }
  .instructions {
    margin: var(--wa-space-m) 0 0;
    padding-left: var(--wa-space-l);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-normal);
    line-height: 1.6;
  }
  .instructions li + li {
    margin-top: var(--wa-space-2xs);
  }
  .instructions-note {
    margin: var(--wa-space-s) 0 0;
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
  }

  a.btn {
    text-decoration: none;
  }

  /* Manual binary-download format picker (factory / OTA / ...). */
  .binary-list {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
    margin-top: var(--wa-space-m);
    text-align: left;
  }
  .binary-option {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--wa-space-s) var(--wa-space-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-l);
    background: none;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background 0.12s,
      border-color 0.12s;
  }
  .binary-option:hover,
  .binary-option:focus-visible {
    background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
    border-color: var(--esphome-primary);
    outline: none;
  }
  .binary-option .title {
    font-weight: var(--wa-font-weight-bold);
    font-size: var(--wa-font-size-s);
  }
  .binary-option .desc {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  .progress-bar {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: var(--wa-color-surface-lowered);
    overflow: hidden;
    margin-top: var(--wa-space-xs);
  }

  .progress-bar-fill {
    height: 100%;
    border-radius: 3px;
    background: var(--esphome-primary);
    transition: width 0.2s;
  }

  .logs-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    margin-top: var(--wa-space-m);
    background: none;
    border: none;
    font-family: inherit;
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    cursor: pointer;
  }
  .logs-toggle:hover {
    color: var(--wa-color-text-normal);
  }
  .logs-toggle wa-icon {
    font-size: 16px;
  }

  .logs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .logs-container {
    margin-top: var(--wa-space-s);
    border: 1px solid var(--term-border);
    border-radius: var(--wa-border-radius-m);
    overflow: hidden;
  }

  esphome-ansi-log {
    --log-height: 50vh;
  }

  esphome-ansi-log::part(container) {
    border-radius: 0;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--wa-space-s);
    margin-top: var(--wa-space-l);
    padding-top: var(--wa-space-m);
    border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 16px;
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    cursor: pointer;
    border: var(--wa-border-width-s) solid transparent;
  }

  .btn--primary {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }
  .btn--ghost {
    background: transparent;
    color: var(--wa-color-text-normal);
    border-color: var(--wa-color-surface-border);
  }
  /* Active state for ghost toggle buttons — mirrors the command-dialog
     and logs-dialog "is-active" treatment so visual language stays consistent. */
  .btn--ghost.is-active {
    background: color-mix(in srgb, var(--esphome-primary), transparent 85%);
    color: var(--esphome-primary);
    border-color: color-mix(in srgb, var(--esphome-primary), transparent 60%);
  }
  .btn--ghost wa-icon {
    font-size: 14px;
  }
`;
