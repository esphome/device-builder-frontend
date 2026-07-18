import { css } from "lit";

/** Inline back affordance (arrow icon + label) for the serial-port flows. */
export const backButtonStyles = css`
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    background: none;
    border: none;
    font-family: inherit;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--esphome-primary);
    cursor: pointer;
  }

  .back-btn wa-icon {
    font-size: 16px;
  }
`;
