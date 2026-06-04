import { css } from "lit";

/** Styles for `<esphome-change-board-dialog>`. */
export const changeBoardDialogStyles = css`
  esphome-base-dialog {
    --width: 480px;
  }

  esphome-base-dialog::part(body) {
    padding: 0 var(--wa-space-l);
  }

  .intro {
    margin: 0 0 var(--wa-space-m);
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
  }

  .board-list {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
    max-height: 48vh;
    overflow-y: auto;
  }

  .board-row {
    display: flex;
    align-items: center;
    gap: var(--wa-space-m);
    width: 100%;
    padding: var(--wa-space-s);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-lowered);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.12s,
      background 0.12s;
  }

  .board-row:hover {
    border-color: var(--esphome-primary);
    background: var(--wa-color-surface-border);
  }

  .board-row:focus-visible {
    outline: var(--wa-border-width-m) solid var(--esphome-primary);
    outline-offset: 2px;
  }

  .board-thumb {
    width: 48px;
    height: 48px;
    object-fit: contain;
    flex-shrink: 0;
    border-radius: var(--wa-border-radius-s);
  }

  .board-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .board-name {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .board-mfr {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--wa-space-s);
    padding: var(--wa-space-m) 0 var(--wa-space-l);
  }

  .btn {
    padding: 8px 18px;
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    cursor: pointer;
    border: none;
    transition: background 0.12s;
  }

  .btn--cancel {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .btn--cancel:hover {
    background: var(--wa-color-surface-border);
  }
`;
