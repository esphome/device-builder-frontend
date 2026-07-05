import { css } from "lit";

/**
 * Shared form-field styles for the automation "add"-family dialogs
 * (add-automation, add-script, add-api-action): the intro paragraph,
 * field labels with a required marker, and the inline error line.
 *
 * Consumers include this in their ``static styles`` array (or compose
 * it into a standalone styles module) and layer any component-specific
 * overrides after it.
 */
export const formFieldStyles = css`
  .intro {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    margin: 0 0 var(--wa-space-m) 0;
    line-height: 1.5;
  }
  .field-label {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
  }
  .required {
    color: var(--esphome-error, #d92d20);
  }
  .error {
    color: var(--esphome-error, #d92d20);
    font-size: var(--wa-font-size-2xs);
    margin-top: var(--wa-space-2xs);
  }
`;
