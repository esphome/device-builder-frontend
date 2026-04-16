import { css } from "lit";

/**
 * Shared cell styles used by device-table and column definitions.
 * Extracted to keep individual files under the 500-line limit.
 */
export const tableCellStyles = css`
  .status-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    vertical-align: middle;
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

  .cell-name {
    font-weight: var(--wa-font-weight-bold);
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

  .cell-tags {
    display: inline-flex;
    gap: 4px;
  }

  .tag {
    display: inline-flex;
    padding: 1px 8px;
    border-radius: var(--wa-border-radius-m);
    font-size: 10px;
    font-weight: var(--wa-font-weight-bold);
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-quiet);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .cell-config {
    color: var(--wa-color-text-quiet);
  }
`;
