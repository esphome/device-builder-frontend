import { css } from "lit";

/**
 * Shared cell styles used by device-table and column definitions.
 * Extracted to keep individual files under the 500-line limit.
 */
export const tableCellStyles = css`
  /* Fixed-size box so the dot, spinner, and recent-status icon all
   * land on the exact same pixel — no horizontal jitter when the row
   * transitions between active / terminated / idle. */
  .cell-status {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--wa-border-radius-m);
  }

  .cell-status-busy {
    cursor: pointer;
    /* Padding + matching negative margin grows the hover halo without
     * shifting the icon position relative to its sibling rows. */
    padding: 4px;
    margin: -4px;
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
    box-shadow: 0 0 6px color-mix(in srgb, var(--esphome-success), transparent 50%);
  }
  .status-dot.offline {
    background: var(--esphome-error);
    box-shadow: 0 0 6px color-mix(in srgb, var(--esphome-error), transparent 60%);
  }
  .status-dot.unknown {
    background: var(--wa-color-text-quiet);
    opacity: 0.5;
  }

  /* Encryption indicator — small lock / lock-open-variant icon next
     to the device name. The 'secure' variant keys off --esphome-success
     so it reads as "this is fine"; the 'insecure' variant shares the
     warning palette so the eye picks insecure devices up at a glance
     without looking alarming for what's a soft warning. Lives next to
     the name, not the status dot, because the status column is small
     and also conveys job-state icons. Fallback colour matches the
     .cell-indicator--modified hex so the warning palette stays
     consistent if --esphome-warning is missing. */
  .cell-encryption {
    font-size: 14px;
    flex-shrink: 0;
    vertical-align: middle;
  }
  .cell-encryption.secure {
    color: var(--esphome-success);
    opacity: 0.85;
  }
  .cell-encryption.insecure {
    color: var(--esphome-warning, #f59e0b);
    opacity: 0.9;
  }
  .cell-encryption.pending {
    color: var(--esphome-primary);
    opacity: 0.9;
  }
  .cell-encryption.mismatch {
    color: var(--esphome-error);
  }

  .status-recent wa-icon {
    font-size: 16px;
  }
  .status-recent--success {
    color: var(--esphome-success);
    /* Pulse the success indicator so it reads as transient — the
       dashboard window for the COMPLETED state is short and the
       throb signals "this is about to go away" instead of looking
       like the device's permanent state. */
    animation: cell-status-completed-pulse 1s ease-in-out infinite;
  }
  .status-recent--failed {
    color: var(--esphome-error);
  }
  .status-recent--cancelled {
    color: var(--wa-color-text-quiet);
  }
  @keyframes cell-status-completed-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }
  /* Honour reduced-motion preferences — keep the icon solid and let
     the success colour alone signal completion. */
  @media (prefers-reduced-motion: reduce) {
    .status-recent--success {
      animation: none;
    }
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
    box-shadow: 0 0 5px
      color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 50%);
  }

  .cell-indicator--update {
    background: var(--esphome-primary);
    box-shadow: 0 0 5px color-mix(in srgb, var(--esphome-primary), transparent 50%);
  }

  .cell-mono {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
  }

  .cell-badge {
    display: inline-flex;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
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
    /* Reset anchor presentation so the Visit Web UI link (rendered
       as <a> for rel=noopener security) matches the surrounding
       <button> action controls — no underline, no visited tint. */
    text-decoration: none;
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

  /* Progressive overflow into the row-end kebab: as the viewport
     narrows we drop inline action buttons in priority order so the
     table keeps as many one-click actions visible as it can.
     Priority order (highest → lowest, last to drop):
       Edit          (always visible)
       Install /
       Update        (mutually exclusive — only one renders)
       Logs
       Visit Web UI
     The kebab in actions-col stays visible at every width and
     mirrors every action the buttons expose, so nothing becomes
     unreachable. Mobile users get the card view by default, so we
     deliberately don't tear the actions column off entirely at any
     viewport — Edit + kebab is a fine fallback if someone forces
     table view on a phone. */
  @media (max-width: 1024px) {
    .cell-action-btn--visit-web {
      display: none;
    }
  }
  @media (max-width: 920px) {
    .cell-action-btn--logs {
      display: none;
    }
  }
  @media (max-width: 820px) {
    .cell-action-btn--install {
      display: none;
    }
  }
`;
