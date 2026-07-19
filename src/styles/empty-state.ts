import { css } from "lit";

/**
 * Shared empty-state blocks.
 *
 * ``empty-message`` is the centered quiet message for "nothing here" and
 * inline error placeholders. ``empty-message--dashed`` is the standalone
 * dashed placeholder card — used on its own, not stacked on the base,
 * because its padding and line-height differ.
 */
export const emptyStateStyles = css`
  .empty-message {
    text-align: center;
    padding: var(--wa-space-l) 0;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
    line-height: 1.5;
  }

  .empty-message--dashed {
    margin: 0;
    padding: var(--wa-space-m) var(--wa-space-s);
    text-align: center;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
    font-style: italic;
    border: 1px dashed var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-lowered, transparent);
  }
`;
