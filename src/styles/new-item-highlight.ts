import { css } from "lit";

/**
 * Highlight for a list row that appeared while the list was on
 * screen (e.g. a serial port plugged in mid-session): a one-shot
 * glow pulse to catch the eye, then a persistent primary border +
 * tint and a "New" badge so the row stays findable.
 */
export const newItemHighlightStyles = css`
  .is-new {
    border-color: var(--esphome-primary);
    background: var(--esphome-tint-faint);
    animation: new-item-glow 2s ease-out 1;
  }
  @keyframes new-item-glow {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--esphome-primary), transparent 40%);
    }
    50% {
      box-shadow: 0 0 0 6px color-mix(in srgb, var(--esphome-primary), transparent 70%);
    }
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--esphome-primary), transparent 100%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .is-new {
      animation: none;
    }
  }

  .new-badge {
    flex-shrink: 0;
    margin-left: auto;
    padding: 1px var(--wa-space-xs);
    border-radius: var(--wa-border-radius-pill, 999px);
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
`;
