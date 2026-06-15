import { css } from "lit";

/** Selectable-card styling shared by the onboarding wizard and the
 *  Settings → Experience section so the two never drift. */
export const choiceCardStyles = css`
  .choices {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
  }

  .choice-card {
    display: flex;
    align-items: flex-start;
    gap: var(--wa-space-m);
    text-align: left;
    padding: var(--wa-space-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-normal);
    font: inherit;
    cursor: pointer;
    transition:
      border-color 0.12s,
      background-color 0.12s;
  }

  .choice-card:hover:not(:disabled) {
    border-color: var(--esphome-primary);
    background: color-mix(in srgb, var(--esphome-primary), transparent 94%);
  }

  .choice-card.selected {
    border-color: var(--esphome-primary);
    background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
  }

  .choice-card:focus-visible {
    outline: none;
    box-shadow: var(--esphome-focus-ring);
  }

  .choice-card:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .choice-icon {
    font-size: 24px;
    line-height: 1;
    color: var(--esphome-primary);
    flex-shrink: 0;
  }

  .choice-text {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-3xs);
  }

  .choice-title {
    font-weight: var(--wa-font-weight-semibold);
  }

  .choice-desc {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
  }
`;
