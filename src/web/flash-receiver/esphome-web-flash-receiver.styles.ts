import { css } from "lit";

/** The flash receiver card's own rules; the shared sheets come first. */
export const flashReceiverStyles = css`
  .wrap {
    width: 90%;
    max-width: 34rem;
    margin: var(--wa-space-2xl) auto;
  }
  .hint {
    margin: 0 0 var(--wa-space-s);
    color: var(--wa-color-text-quiet);
  }
  .warning-banner {
    margin: 0 0 var(--wa-space-s);
  }
  /* What the board needs from the user's hands: the strap, a reset. */
  .waiting {
    margin: 0 0 var(--wa-space-s);
    padding: var(--wa-space-s);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-lowered);
    font-size: var(--wa-font-size-s);
  }
  .status {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    margin-bottom: var(--wa-space-s);
    font-weight: var(--wa-font-weight-semibold);
  }
  .status wa-spinner {
    font-size: 1rem;
  }
  .status--error {
    color: var(--esphome-error);
  }
  .status--done {
    color: var(--esphome-success);
  }
  .progress {
    height: 6px;
    border-radius: 999px;
    background: var(--wa-color-surface-lowered);
    overflow: hidden;
    margin-bottom: var(--wa-space-s);
  }
  .progress-fill {
    height: 100%;
    background: var(--esphome-primary);
    transition: width 0.2s;
  }
  esphome-ansi-log {
    display: block;
    height: min(45vh, 22rem);
    border-radius: var(--wa-border-radius-m);
    overflow: hidden;
  }
  .manual {
    display: block;
    margin-top: var(--wa-space-m);
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
  }
  .manual input {
    display: block;
    margin-top: var(--wa-space-2xs);
  }
`;
