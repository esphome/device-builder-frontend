import { css } from "lit";

/**
 * ``renderAsyncState``'s message block as a full-page load state: a
 * centered spinner-over-text column. Consumers add the placement rule
 * (grid area, flex child) for their own layout.
 */
export const loadMessageStyles = css`
  .message {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--wa-space-m);
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
    text-align: center;
  }

  .message wa-spinner {
    font-size: 32px;
  }

  .message.error {
    color: var(--wa-color-danger-text-normal);
  }
`;
