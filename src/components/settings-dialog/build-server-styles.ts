import { css } from "lit";

export const buildServerCardStyles = css`
  .build-server-card {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
    padding: var(--wa-space-m);
    margin: 0 var(--wa-space-m) var(--wa-space-m) var(--wa-space-m);
    background: var(--wa-color-surface-default);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
  }

  .build-server-row {
    display: flex;
    align-items: baseline;
    gap: var(--wa-space-s);
    flex-wrap: wrap;
  }

  .build-server-label {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-quiet);
    min-width: 110px;
  }

  .build-server-pin {
    font-family: var(--wa-font-family-mono, monospace);
    font-size: var(--wa-font-size-xs);
    word-break: break-all;
    flex: 1;
  }

  /* Pin row stacks vertically so the emoji grid gets its own line. */
  .build-server-row--pin {
    align-items: flex-start;
  }

  .build-server-pin-display {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }

  .build-server-dashboard-id {
    font-family: var(--wa-font-family-mono, monospace);
    font-size: var(--wa-font-size-s);
    word-break: break-all;
    flex: 1;
  }

  .build-server-versions {
    display: flex;
    gap: var(--wa-space-l);
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
  }

  .build-server-versions code {
    font-family: var(--wa-font-family-mono, monospace);
    color: var(--wa-color-text-normal);
    margin-left: var(--wa-space-xs);
  }

  .build-server-actions {
    display: flex;
    gap: var(--wa-space-s);
    align-items: center;
    flex-wrap: wrap;
  }

  .build-server-copy,
  .build-server-rotate {
    padding: 6px var(--wa-space-m);
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-s);
    color: var(--wa-color-text-normal);
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    cursor: pointer;
  }

  .build-server-rotate {
    color: var(--wa-color-danger-on-quiet, #b00020);
    border-color: var(--wa-color-danger-on-quiet, #b00020);
  }

  .build-server-rotate:disabled,
  .build-server-copy:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .build-server-listener-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px var(--wa-space-s);
    border-radius: var(--wa-border-radius-pill, 999px);
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
  }

  .build-server-listener-up {
    background: var(--wa-color-success-quiet, #d6f5dd);
    color: var(--wa-color-success-on-quiet, #036a1c);
  }

  .build-server-listener-down {
    background: var(--wa-color-warning-quiet, #fff3cd);
    color: var(--wa-color-warning-on-quiet, #8a6d3b);
  }
`;

export const cleanupTtlStyles = css`
  .cleanup-ttl-input {
    display: inline-flex;
    align-items: baseline;
    gap: var(--wa-space-2xs);
    flex-shrink: 0;
  }

  .cleanup-ttl-number {
    width: 5em;
    text-align: right;
    padding: var(--wa-space-2xs) var(--wa-space-xs);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-normal);
    font-family: inherit;
    font-size: var(--wa-font-size-s);
  }

  .cleanup-ttl-number:focus {
    outline: none;
    border-color: var(--esphome-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--esphome-primary), transparent 80%);
  }

  .cleanup-ttl-unit {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
  }
`;
