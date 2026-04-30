import { css } from "lit";

/**
 * Shared cell styles used by device-table and column definitions.
 * Extracted to keep individual files under the 500-line limit.
 */
export const tableCellStyles = css`
  .cell-status-center {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
  }

  .cell-status-busy {
    cursor: pointer;
    border-radius: var(--wa-border-radius-m);
    padding: 4px;
    transition: background 0.12s;
  }
  .cell-status-busy:hover,
  .cell-status-busy:focus-visible {
    background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
    outline: none;
  }

  .status-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .status-dot.online {
    background: var(--esphome-success);
    box-shadow: 0 0 6px
      color-mix(in srgb, var(--esphome-success), transparent 50%);
  }
  .status-dot.offline {
    background: var(--esphome-error);
    box-shadow: 0 0 6px
      color-mix(in srgb, var(--esphome-error), transparent 60%);
  }
  .status-dot.unknown {
    background: var(--wa-color-text-quiet);
    opacity: 0.5;
  }

  .cell-name-wrap {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .cell-name {
    font-weight: var(--wa-font-weight-bold);
  }

  .cell-indicator {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .cell-indicator--modified {
    background: var(--esphome-warning, #f59e0b);
    box-shadow: 0 0 5px color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 50%);
  }

  .cell-indicator--update {
    background: var(--esphome-primary);
    box-shadow: 0 0 5px color-mix(in srgb, var(--esphome-primary), transparent 50%);
  }

  .cell-mono {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
      monospace;
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
  }

  .cell-badge {
    display: inline-flex;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    background: color-mix(
      in srgb,
      var(--esphome-primary),
      transparent 88%
    );
    color: var(--esphome-primary);
    letter-spacing: 0.02em;
  }

  .cell-muted {
    color: var(--wa-color-text-quiet);
    font-style: italic;
  }

  .cell-comment {
    color: var(--wa-color-text-quiet);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cell-config {
    color: var(--wa-color-text-quiet);
  }

  .cell-actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .cell-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: var(--wa-border-width-s) solid transparent;
    border-radius: var(--wa-border-radius-m);
    background: transparent;
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    padding: 0;
    transition:
      background 0.12s,
      color 0.12s,
      border-color 0.12s;
  }

  .cell-action-btn:hover {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
  }

  .cell-action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
  }

  .cell-action-btn wa-icon {
    font-size: 16px;
  }

  .cell-action-btn--accent {
    color: var(--esphome-primary);
  }

  .cell-action-btn--accent:hover {
    background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
    color: var(--esphome-primary);
    border-color: color-mix(in srgb, var(--esphome-primary), transparent 70%);
  }
`;
