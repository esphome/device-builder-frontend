import { css } from "lit";

/**
 * The what-is-included disclosure list shown before a report leaves the
 * app: the crash-report dialog's summary and the feedback device
 * picker's disclosure share this shape.
 */
export const summaryListStyles = css`
  .summary {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    margin: 0 0 var(--wa-space-m);
    padding: 0;
    list-style: none;
    font-size: var(--wa-font-size-s);
  }

  .summary li {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
  }

  .summary wa-icon {
    flex-shrink: 0;
    color: var(--esphome-primary);
  }

  .summary li.degraded {
    color: var(--wa-color-text-quiet);
  }

  .summary li.degraded wa-icon {
    color: var(--wa-color-warning-fill-loud, orange);
  }
`;
