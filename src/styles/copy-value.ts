/** Click-to-copy code value (`renderCopyValue`): the text is the button. */
import { css } from "lit";

export const copyValueStyles = css`
  .copy-value {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: var(--wa-space-2xs);
    margin-top: var(--wa-space-2xs);
    padding: 2px 0;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--esphome-primary);
    font: inherit;
    cursor: pointer;
  }

  .copy-value code {
    font-size: var(--wa-font-size-2xs);
  }

  /* Outranks a host's generic icon sizing (e.g. the option rows' 28px). */
  button.copy-value wa-icon {
    font-size: 14px;
    color: inherit;
  }

  .copy-value:hover,
  .copy-value:focus-visible {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .copy-value:focus-visible {
    outline: var(--esphome-focus-outline);
    outline-offset: 2px;
  }
`;
