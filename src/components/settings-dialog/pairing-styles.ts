import { css } from "lit";

export const pairingWindowStyles = css`
  /* Reset uppercase/letter-spacing inherited from .section-heading. */
  .pairing-window-pill,
  .pairing-window-countdown,
  .pairing-window-extend {
    text-transform: none;
    letter-spacing: normal;
    font-weight: var(--wa-font-weight-semibold);
  }

  .pairing-window-pill {
    font-size: var(--wa-font-size-xs);
    padding: 1px 8px;
    border-radius: var(--wa-border-radius-pill, 999px);
  }

  .pairing-window-open {
    background: color-mix(in srgb, var(--esphome-success, #16a34a), transparent 80%);
    color: var(--esphome-success, #16a34a);
  }

  .pairing-window-closed {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-quiet);
  }

  .pairing-window-countdown {
    font-family: var(--wa-font-family-mono, monospace);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-normal);
    font-variant-numeric: tabular-nums;
  }

  .pairing-window-extend {
    margin-inline-start: auto;
    padding: 2px 10px;
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    color: var(--wa-color-text-normal);
    font: inherit;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    cursor: pointer;
  }

  .pairing-window-extend:hover,
  .pairing-window-extend:focus-visible {
    background: var(--wa-color-surface-border);
  }
`;
