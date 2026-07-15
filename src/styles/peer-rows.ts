import { css } from "lit";

/**
 * Peer-row fragments shared across the settings sections (paired senders,
 * offloader pairings) and the dashboard's Build server panel: the
 * connected/disconnected pill, the destructive remove button, and the
 * details disclosure.
 */
export const peerRowStyles = css`
  .peer-row .row-title {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
  }

  /* Destructive remove/unpair icon button: neutral bordered square at
     rest, error tint on hover/focus. Single source for both the
     approved-senders Remove (build-server-section) and the offloader
     unpair trash (build-offload-pairing-row). */
  .peer-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    flex-shrink: 0;
  }

  .peer-remove wa-icon {
    font-size: 16px;
  }

  .peer-remove:hover,
  .peer-remove:focus-visible {
    background: color-mix(in srgb, var(--esphome-error), white 90%);
    color: var(--esphome-error);
    border-color: var(--esphome-error);
  }

  .peer-remove:focus-visible {
    outline: none;
    box-shadow: var(--esphome-focus-ring);
  }

  .peer-connection-pill {
    display: inline-block;
    padding: 1px 6px;
    margin-left: var(--wa-space-xs);
    border-radius: 4px;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .peer-connection-connected {
    background: color-mix(in srgb, var(--esphome-success, #16a34a), transparent 80%);
    color: var(--esphome-success, #16a34a);
  }

  .peer-connection-disconnected {
    background: color-mix(in srgb, var(--wa-color-neutral-500, #6b7280), transparent 80%);
    color: var(--wa-color-neutral-500, #6b7280);
  }

  .peer-connection-connecting {
    background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 80%);
    color: var(--esphome-warning, #f59e0b);
  }

  /*
   * "Show details" disclosure under an approved peer row. Mirrors
   * the .pin-hex styling shape (small / quiet / pointer cursor on
   * the summary) so the two disclosures feel like the same widget
   * across the section. The body is a two-column dl so field
   * labels align in their own gutter.
   */
  .peer-details {
    margin-top: var(--wa-space-2xs);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  .peer-details summary {
    cursor: pointer;
    user-select: none;
  }

  .peer-details-list {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px var(--wa-space-s);
    margin: 4px 0 0 0;
    padding: 0;
  }

  .peer-details-list dt {
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
  }

  .peer-details-list dd {
    margin: 0;
    color: var(--wa-color-text-normal);
  }

  .peer-details-list code {
    font-family: var(--wa-font-family-code);
    word-break: break-all;
  }

  .peer-details-desc {
    display: block;
    margin-top: 2px;
    color: var(--wa-color-text-quiet);
  }
`;
