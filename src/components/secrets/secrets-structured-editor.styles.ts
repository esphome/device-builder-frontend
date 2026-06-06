import { css } from "lit";

export const secretsStructuredEditorStyles = css`
  :host {
    display: block;
    height: 100%;
    box-sizing: border-box;
    overflow-y: auto;
    /* This element is the single scroll container for the form pane, so
       the clearance for the floating Save button has to live here — the
       wrapping pane never scrolls. */
    padding-bottom: calc(var(--wa-space-m) * 2 + 2.25rem);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
  }

  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-l);
  }

  .group-header {
    margin: 0 0 var(--wa-space-s);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
    text-transform: none;
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    padding-bottom: 4px;
  }

  .group-link {
    color: var(--esphome-primary);
    text-decoration: none;
  }

  .group-link:hover {
    text-decoration: underline;
  }

  /* Keep the dialog tidy and let every field span its full width — the
     base-dialog body is a row layout meant for icon + text, so the add
     form overrides it to a stretched column. */
  esphome-base-dialog {
    --width: 480px;
  }

  .add-body {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--wa-space-m);
  }

  .add-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }

  .add-field-label {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
  }

  .add-field input,
  .add-field esphome-password-input,
  .add-select {
    width: 100%;
    box-sizing: border-box;
  }

  .add-select {
    min-height: var(--wa-form-control-height);
    padding: 0 12px;
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
  }

  .btn--add {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .btn--add:hover {
    background: var(--esphome-primary-hover);
  }

  /* The password input is a block custom element; stretch it into the
     value column so it lines up with the key input and remove button. */
  .value-input {
    min-width: 0;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(8rem, 1fr) minmax(8rem, 2fr) auto;
    gap: var(--wa-space-s);
    align-items: center;
  }

  .row--advanced {
    grid-template-columns: minmax(8rem, 1fr) minmax(8rem, 2fr) auto;
  }

  .key-error {
    grid-column: 1 / -1;
    margin: -2px 0 2px;
    font-size: var(--wa-font-size-2xs);
    color: var(--esphome-error);
  }

  .advanced-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    min-height: var(--wa-form-control-height);
    box-sizing: border-box;
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-xs);
  }

  .advanced-badge wa-icon {
    font-size: 15px;
    flex-shrink: 0;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--wa-form-control-height);
    height: var(--wa-form-control-height);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-raised);
    color: var(--wa-color-text-quiet);
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      color 0.12s,
      border-color 0.12s,
      background 0.12s;
  }

  .icon-btn:hover {
    color: var(--esphome-error);
    border-color: var(--esphome-error);
  }

  .icon-btn wa-icon {
    font-size: 16px;
  }

  .add-row {
    margin-top: var(--wa-space-m);
  }

  .add-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: var(--wa-border-width-s) dashed var(--esphome-primary);
    background: var(--esphome-tint);
    color: var(--esphome-primary);
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    transition: background 0.12s;
  }

  .add-btn:hover {
    background: var(--esphome-tint-strong);
  }

  .add-btn wa-icon {
    font-size: 16px;
  }

  .empty {
    padding: var(--wa-space-l) 0;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
  }
`;
