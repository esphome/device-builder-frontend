import { css } from "lit";

export const offloaderAlertStyles = css`
  .offloader-alert {
    display: flex;
    align-items: flex-start;
    gap: var(--wa-space-m);
    padding: var(--wa-space-m);
    margin: var(--wa-space-s) var(--wa-space-m);
    border-radius: var(--wa-border-radius-m);
    border-left: 4px solid var(--esphome-warning, #f59e0b);
    background: color-mix(
      in srgb,
      var(--esphome-warning, #f59e0b),
      transparent 92%
    );
  }

  .offloader-alert-peer-revoked {
    border-left-color: var(--esphome-error, #dc2626);
    background: color-mix(
      in srgb,
      var(--esphome-error, #dc2626),
      transparent 92%
    );
  }

  .offloader-alert-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
  }

  .offloader-alert-title {
    font-weight: var(--wa-font-weight-semibold);
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text);
  }

  .offloader-alert-desc {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
  }

  .offloader-alert-actions {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
    flex-shrink: 0;
  }
`;

export const pairingRowStyles = css`
  .pair-build-server-row {
    align-items: center;
    gap: var(--wa-space-s);
  }

  .btn-pair-build-server {
    height: 36px;
    padding: 0 var(--wa-space-m);
    border: none;
    border-radius: var(--wa-border-radius-s);
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    font: inherit;
    font-weight: var(--wa-font-weight-semibold);
    cursor: pointer;
    flex-shrink: 0;
  }

  .btn-pair-build-server:hover:not(:disabled) {
    background: color-mix(in srgb, var(--esphome-primary), black 10%);
  }

  .btn-pair-build-server:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-pair-row {
    height: 32px;
    font-size: var(--wa-font-size-xs);
  }

  .btn-unpair {
    height: 32px;
    padding: 0 var(--wa-space-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-quiet);
    font: inherit;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    cursor: pointer;
    flex-shrink: 0;
  }

  .btn-unpair:hover {
    background: color-mix(in srgb, var(--esphome-error), white 90%);
    color: var(--esphome-error);
    border-color: var(--esphome-error);
  }

  .btn-edit-endpoint {
    height: 32px;
    width: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    flex-shrink: 0;
  }

  .btn-edit-endpoint:hover {
    background: color-mix(in srgb, var(--esphome-primary), white 90%);
    color: var(--esphome-primary);
    border-color: var(--esphome-primary);
  }

  .btn-edit-endpoint wa-icon {
    font-size: 16px;
  }

  .pairing-row {
    align-items: center;
    gap: var(--wa-space-s);
  }

  .pairing-status-pill {
    display: inline-block;
    padding: 1px 6px;
    margin-left: var(--wa-space-xs);
    border-radius: 4px;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .pairing-status-pending {
    background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 80%);
    color: var(--esphome-warning, #f59e0b);
  }

  .pairing-status-approved {
    background: color-mix(in srgb, var(--esphome-success, #16a34a), transparent 80%);
    color: var(--esphome-success, #16a34a);
  }

  .pairing-last-error {
    font-style: italic;
    word-break: break-word;
  }

  .pairing-version-mismatch {
    word-break: break-word;
  }

  .pairing-version-mismatch--release {
    color: var(--esphome-warning, #f59e0b);
  }
`;
