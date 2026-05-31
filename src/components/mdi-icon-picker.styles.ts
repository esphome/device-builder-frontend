import { css } from "lit";

export const mdiIconPickerStyles = css`
  :host {
    display: block;
    position: relative;
  }

  /* Trigger — shaped like the project's standard input */
  .trigger {
    width: 100%;
    box-sizing: border-box;
    min-height: var(--wa-form-control-height);
    padding: 0 14px;
    font-size: var(--wa-font-size-s);
    font-family: inherit;
    line-height: var(--wa-form-control-value-line-height);
    color: var(--wa-color-text-normal);
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    outline: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }

  .trigger:focus,
  :host([open]) .trigger {
    border-color: var(--esphome-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--esphome-primary), transparent 80%);
  }

  .trigger.invalid {
    border-color: var(--esphome-error);
  }

  .trigger.invalid:focus {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--esphome-error), transparent 80%);
  }

  .trigger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .trigger-icon {
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--wa-border-radius-s);
    background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
    color: var(--esphome-primary);
  }

  .trigger-icon svg {
    width: 16px;
    height: 16px;
  }

  .trigger-icon--empty {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-quiet);
  }

  .trigger-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--wa-font-family-code, monospace);
    font-size: var(--wa-font-size-s);
  }

  .trigger-label.placeholder {
    color: var(--wa-color-text-quiet);
    font-family: inherit;
  }

  .trigger-clear {
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
    color: var(--wa-color-text-quiet);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--wa-border-radius-s);
  }

  .trigger-clear:hover {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
  }

  .trigger-chevron {
    width: 14px;
    height: 14px;
    color: var(--wa-color-text-quiet);
    flex: 0 0 14px;
    transition: transform 0.15s;
  }

  :host([open]) .trigger-chevron {
    transform: rotate(180deg);
  }

  /* Panel */
  .panel {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    max-height: 380px;
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    box-shadow:
      0 8px 24px rgba(0, 0, 0, 0.12),
      0 2px 6px rgba(0, 0, 0, 0.06);
    overflow: hidden;
    animation: panelIn 0.12s ease-out;
  }

  @keyframes panelIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .search {
    position: relative;
    padding: 10px 12px;
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .search-icon {
    position: absolute;
    left: 22px;
    top: 50%;
    transform: translateY(-50%);
    width: 14px;
    height: 14px;
    color: var(--wa-color-text-quiet);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 10px 7px 32px !important;
    min-height: 32px !important;
    font-size: var(--wa-font-size-s);
  }

  .grid-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
    gap: 4px;
  }

  .icon-cell {
    position: relative;
    aspect-ratio: 1;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--wa-border-radius-s);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--wa-color-text-normal);
    padding: 0;
    transition:
      background 0.1s,
      border-color 0.1s,
      color 0.1s,
      transform 0.08s;
  }

  .icon-cell svg {
    width: 20px;
    height: 20px;
  }

  .icon-cell:hover {
    background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
    color: var(--esphome-primary);
    border-color: color-mix(in srgb, var(--esphome-primary), transparent 70%);
    transform: scale(1.06);
  }

  .icon-cell--selected {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .icon-cell--selected:hover {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    transform: scale(1.06);
  }

  .empty,
  .loading {
    padding: 24px 16px;
    text-align: center;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .footer {
    padding: 6px 12px;
    border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .footer-name {
    font-family: var(--wa-font-family-code, monospace);
    color: var(--wa-color-text-normal);
    font-size: var(--wa-font-size-xs);
  }
`;
