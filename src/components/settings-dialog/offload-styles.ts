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
    background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 92%);
  }

  .offloader-alert-peer-revoked {
    border-left-color: var(--esphome-error, #dc2626);
    background: color-mix(in srgb, var(--esphome-error, #dc2626), transparent 92%);
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
  /* Wraps so a wide button label (German) drops below the helper text
     instead of squeezing it to a word per line on narrow viewports. */
  .pair-build-server-row {
    align-items: center;
    gap: var(--wa-space-s);
    flex-wrap: wrap;
  }

  .pair-build-server-row .row-label {
    flex: 1 1 240px;
  }

  .pair-build-server-row .btn-pair-build-server {
    margin-left: auto;
  }

  .btn-pair-build-server {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 36px;
    padding: 0 14px;
    border: none;
    /* Match the rest of the dashboard's primary buttons — the old
       border-radius-s gave the button an unfinished-rectangle look
       that read out of place next to the rounded toggles / cards /
       chips elsewhere in the settings dialog. */
    border-radius: var(--wa-border-radius-m);
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    font: inherit;
    font-weight: var(--wa-font-weight-semibold);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background-color 0.12s,
      transform 0.05s ease-out;
  }

  .btn-pair-build-server:hover:not(:disabled) {
    background: var(--esphome-primary-hover);
  }

  .btn-pair-build-server:active:not(:disabled) {
    transform: translateY(1px);
  }

  .btn-pair-build-server:focus-visible {
    outline: none;
    box-shadow: var(--esphome-focus-ring);
  }

  .btn-pair-build-server:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-pair-build-server wa-icon {
    font-size: 16px;
    line-height: 0;
  }

  .btn-pair-row {
    height: 32px;
    padding: 0 12px;
    font-size: var(--wa-font-size-xs);
    gap: 4px;
  }

  .btn-pair-row wa-icon {
    font-size: 14px;
  }

  /* Shared chrome for the section's secondary action buttons: the
     pairing row's icon Edit square, its Build-remote / View-build
     text actions, and the alert's text Unpair (.offloader-alert-unpair
     markup lives in build-offload-alert.ts; its chrome stays here with
     its siblings). The pairing row's trash button is the shared
     .peer-remove in shared-styles.ts. */
  .btn-edit-endpoint,
  .btn-build-remote,
  .btn-view-remote-build,
  .offloader-alert-unpair {
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    flex-shrink: 0;
  }

  .btn-edit-endpoint {
    width: 32px;
    border-radius: var(--wa-border-radius-s);
  }

  .btn-edit-endpoint wa-icon {
    font-size: 16px;
  }

  /* Destructive actions tint error on hover; edit tints primary. */
  .offloader-alert-unpair:hover {
    background: color-mix(in srgb, var(--esphome-error), white 90%);
    color: var(--esphome-error);
    border-color: var(--esphome-error);
  }

  .btn-edit-endpoint:hover,
  .btn-build-remote:hover,
  .btn-view-remote-build:hover {
    background: color-mix(in srgb, var(--esphome-primary), white 90%);
    color: var(--esphome-primary);
    border-color: var(--esphome-primary);
  }

  /* Text variant — the pairing row's Build-remote / View-build actions
     and the alert's spelled-out Unpair (next to the Re-pair pill) get
     padding and the pill's radius instead of the icon-square shape. */
  .btn-build-remote,
  .btn-view-remote-build,
  .offloader-alert-unpair {
    padding: 0 12px;
    border-radius: var(--wa-border-radius-m);
    font: inherit;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
  }

  .btn-edit-endpoint:focus-visible,
  .btn-build-remote:focus-visible,
  .btn-view-remote-build:focus-visible,
  .offloader-alert-unpair:focus-visible {
    outline: none;
    box-shadow: var(--esphome-focus-ring);
  }

  /* The per-pairing enable toggle stays on the title line beside
     the status pill so it reads as part of the server identity,
     not as an action; margin-left: auto pushes it to the right
     edge of the title flex. */
  .pairing-toggle {
    margin-left: auto;
  }

  /* Lives at the bottom of a .row--stacked pairing row. Wraps so a
     narrow dialog (HA-addon sidebar, mobile) doesn't clip the
     rightmost button when Build + View + edit + Unpair are all
     present. */
  .pairing-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
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
