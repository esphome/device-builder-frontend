import { css } from "lit";

import { MOBILE_BREAKPOINT } from "../../styles/breakpoints.js";

export const pairBuildServerDialogStyles = css`
  esphome-base-dialog {
    --width: 500px;
  }

  /* Neutral header + title chrome, inlined rather than composed from
     dialogChromeStyles: that shared block also hides the footer part, and this
     wizard renders its actions in the footer so they stay pinned while a tall
     confirm step scrolls. */
  esphome-base-dialog::part(header) {
    padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
  }

  esphome-base-dialog::part(title) {
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  esphome-base-dialog::part(body) {
    padding: 0 var(--wa-space-l);
  }

  .description {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    padding-bottom: var(--wa-space-m);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
    padding-bottom: var(--wa-space-m);
  }

  .row {
    display: flex;
    gap: var(--wa-space-s);
    padding-bottom: var(--wa-space-m);
  }

  .row .field {
    flex: 1;
    padding-bottom: 0;
  }

  .field--port {
    flex: 0 0 110px;
  }

  label {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
  }

  .helper {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    margin-top: var(--wa-space-2xs);
  }

  .pin-card {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
    padding: var(--wa-space-m);
    margin-bottom: var(--wa-space-m);
    background: var(--wa-color-surface-default);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
  }

  .pin-card-label {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
  }

  .pin-card code {
    font-family: var(--wa-font-family-mono, monospace);
    font-size: var(--wa-font-size-xs);
    word-break: break-all;
  }

  .pin-card-target {
    font-family: var(--wa-font-family-mono, monospace);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  /* Rendered into wa-dialog's footer slot (pinned outside the scrolling
     body) so the error + actions stay visible regardless of body scroll. */
  .dialog-footer {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--wa-space-s);
  }

  .pin-connecting {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
  }

  .field-error {
    color: var(--esphome-error);
    font-size: var(--wa-font-size-xs);
    margin-top: var(--wa-space-2xs);
  }

  .step-error {
    color: var(--esphome-error);
    font-size: var(--wa-font-size-s);
  }

  .trust-warning {
    margin-bottom: var(--wa-space-m);
    padding: var(--wa-space-s) var(--wa-space-m);
    border-left: 3px solid var(--esphome-warning, #f59e0b);
    background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 90%);
    color: var(--wa-color-text-normal);
    font-size: var(--wa-font-size-s);
  }

  .sent-body {
    padding-bottom: var(--wa-space-m);
    font-size: var(--wa-font-size-s);
  }

  .sent-body code {
    font-family: var(--wa-font-family-mono, monospace);
    font-size: var(--wa-font-size-xs);
  }

  /* On the mobile full-screen sheet the desktop header breathing room wastes
     vertical space; tighten the top padding there only. */
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    esphome-base-dialog::part(header) {
      padding-top: var(--wa-space-s);
    }
  }
`;
