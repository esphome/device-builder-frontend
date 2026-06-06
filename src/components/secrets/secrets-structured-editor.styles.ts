import { css } from "lit";

export const secretsStructuredEditorStyles = css`
  :host {
    display: block;
    height: 100%;
    overflow-y: auto;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
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
