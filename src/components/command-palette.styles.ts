import { css } from "lit";

export const commandPaletteStyles = css`
  :host {
    position: fixed;
    inset: 0;
    z-index: 1000;
    pointer-events: none;
  }

  :host([hidden]) {
    display: none;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
    pointer-events: auto;
    animation: fade-in 0.12s ease-out;
  }

  .dialog {
    position: fixed;
    top: 18%;
    left: 50%;
    transform: translate(-50%, 0);
    width: min(640px, calc(100vw - var(--wa-space-l)));
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-l);
    box-shadow: 0 24px 56px rgba(0, 0, 0, 0.25);
    overflow: hidden;
    pointer-events: auto;
    animation: pop-in 0.14s ease-out;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes pop-in {
    from { opacity: 0; transform: translate(-50%, -8px) scale(0.98); }
    to { opacity: 1; transform: translate(-50%, 0) scale(1); }
  }

  .search {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: 14px 16px;
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .search > wa-icon {
    font-size: 18px;
    color: var(--wa-color-text-quiet);
  }

  .search-input {
    flex: 1;
    border: none;
    background: transparent;
    outline: none;
    font-size: var(--wa-font-size-s);
    font-family: inherit;
    color: var(--wa-color-text-normal);
  }

  .search-input::placeholder {
    color: var(--wa-color-text-quiet);
  }

  .list {
    max-height: 420px;
    overflow-y: auto;
    padding: var(--wa-space-2xs);
  }

  .group + .group {
    margin-top: var(--wa-space-2xs);
  }

  .group-heading {
    padding: 8px 10px 4px;
    font-size: 11px;
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
    cursor: pointer;
    user-select: none;
    transition: background 0.08s;
  }

  .item--selected {
    background: var(--wa-color-surface-lowered);
  }

  .item wa-icon {
    font-size: 16px;
    color: var(--wa-color-text-quiet);
    flex-shrink: 0;
  }

  .item--selected wa-icon {
    color: var(--esphome-primary);
  }

  .item-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty {
    padding: 32px 16px;
    text-align: center;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--wa-space-s);
    padding: 8px 12px;
    border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-lowered);
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
  }

  kbd {
    font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", monospace;
    font-size: 10px;
    background: var(--wa-color-surface-default);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: 4px;
    padding: 1px 5px;
  }
`;
