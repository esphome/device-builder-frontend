import { css } from "lit";

export const firmwareRepositoryDialogStyles = css`
  :host {
    display: contents;
  }

  esphome-base-dialog {
    --width: min(760px, calc(100vw - 32px));
  }

  .record-heading {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
  }

  .repository-content {
    display: grid;
    gap: var(--wa-space-s);
  }

  .save-form {
    display: grid;
    gap: var(--wa-space-m);
  }

  .save-field {
    display: grid;
    gap: var(--wa-space-xs);
    color: var(--wa-color-text-normal);
    font-size: var(--wa-font-size-s);
  }

  .save-field input,
  .save-field textarea {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: var(--wa-space-s);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-normal);
    font: inherit;
  }

  .save-field textarea {
    resize: vertical;
  }

  .save-form-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--wa-space-s);
  }

  .save-submit-btn {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .save-submit-btn:hover {
    background: var(--esphome-primary-hover);
  }

  .artifact-split-btn {
    flex-shrink: 0;
  }

  .artifact-dropdown {
    display: inline-flex;
  }

  .artifact-split-btn wa-button::part(base) {
    height: 28px;
    min-height: 28px;
    padding-inline: var(--wa-space-xs);
    border-color: var(--wa-color-surface-border);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-normal);
    font-family: var(--wa-font-family-body);
    font-size: var(--wa-font-size-2xs);
    font-weight: 400;
  }

  .artifact-split-btn wa-button.artifact-download-main::part(base) {
    font-weight: var(--wa-font-weight-semibold);
  }

  .artifact-split-btn wa-button::part(base):hover {
    background: var(--esphome-tint);
  }

  .artifact-dropdown wa-dropdown-item::part(label) {
    font-size: var(--wa-font-size-2xs);
  }

  .artifact-type {
    padding: 2px var(--wa-space-xs);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-semibold);
  }

  .record h3 {
    margin: 0;
    font-size: var(--wa-font-size-m);
    overflow-wrap: break-word;
    word-break: normal;
  }

  .status {
    padding: 2px var(--wa-space-xs);
    border-radius: var(--wa-border-radius-s);
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
  }

  .status--saved {
    background: var(--wa-color-warning-quiet, #fff3cd);
    color: var(--wa-color-warning-on-quiet, #8a6d3b);
  }

  .status--published {
    background: var(--wa-color-success-quiet, #d6f5dd);
    color: var(--wa-color-success-on-quiet, #036a1c);
  }

  .status--obsolete {
    background: color-mix(in srgb, var(--wa-color-neutral-500, #6b7280), transparent 80%);
    color: var(--wa-color-neutral-500, #6b7280);
  }

  .artifact-download-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--wa-space-s);
    margin-top: var(--wa-space-xs);
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }

  .artifact-download-row .action-btn {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .version-actions {
    position: relative;
    display: inline-flex;
    align-items: center;
    margin-left: auto;
  }

  .version-menu-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-normal);
    cursor: pointer;
  }

  .version-menu-btn:hover {
    background: var(--esphome-tint);
  }

  .version-menu-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .version-menu-btn wa-icon {
    font-size: 18px;
  }

  .version-menu {
    position: fixed;
    inset: auto;
    margin: 0;
    min-width: 180px;
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    max-height: calc(100dvh - 16px);
    overflow-y: auto;
  }

  .menu-item--danger,
  .menu-item--danger wa-icon {
    color: var(--esphome-error);
  }

  .action-btn,
  .refresh-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--wa-space-xs);
    min-height: 36px;
    padding: 0 var(--wa-space-s);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-normal);
    cursor: pointer;
  }

  .action-btn:hover,
  .refresh-btn:hover {
    background: var(--esphome-tint);
  }

  .action-btn:disabled,
  .refresh-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .compact-download-btn {
    min-height: 28px;
    padding: 0 var(--wa-space-xs);
    font-size: var(--wa-font-size-2xs);
  }

  .action-btn--danger {
    color: var(--esphome-error);
  }

  .state {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    min-height: 80px;
    color: var(--wa-color-text-quiet);
  }

  .state--error {
    color: var(--esphome-error);
  }

  @media (max-width: 560px) {
    .record-heading {
      flex-wrap: wrap;
    }

    .artifact-download-row {
      align-items: flex-start;
      flex-direction: column;
    }

    .artifact-split-btn {
      max-width: 100%;
    }
  }
`;
