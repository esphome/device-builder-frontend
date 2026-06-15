import { css } from "lit";

/** Styling for the shared `renderWifiFields` markup (.field / label / .field-label / .error),
 *  used by both the wizard's Wi-Fi step and the standalone rotation dialog so
 *  the two can't drift. */
export const wifiFieldsStyles = css`
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
  }

  label,
  .field-label {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .error {
    color: var(--esphome-error);
    font-size: var(--wa-font-size-s);
  }
`;
