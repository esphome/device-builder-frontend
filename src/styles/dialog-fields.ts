import { css } from "lit";

/**
 * Shared field-stack styles for the single-text-input dialogs
 * (rename-device, clone-device, friendly-name): the labelled column
 * around the input plus the helper / error / warning lines beneath it.
 *
 * Distinct from ``formFieldStyles`` (form-fields.ts) on purpose — the
 * automation "add"-family dialogs use a different convention
 * (``.field-label`` / ``.error``, normal-weight text) and unifying the
 * two is a larger visual change than a style extraction should make.
 *
 * Consumers keep their own ``esphome-base-dialog { --width }`` and
 * ``::part(body)`` padding local and layer overrides after this.
 */
export const dialogFieldStyles = css`
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
    padding-bottom: var(--wa-space-m);
  }

  label {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
  }

  .helper {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    margin-top: var(--wa-space-2xs);
  }

  .field-error {
    color: var(--esphome-error);
    font-size: var(--wa-font-size-xs);
    margin-top: var(--wa-space-2xs);
  }

  /* Soft warning shown alongside the input — same slot as the hard
     error but warning-coloured so the user can tell the two apart,
     and the submit button stays enabled. */
  .field-warning {
    color: var(--esphome-warning, #d97706);
    font-size: var(--wa-font-size-xs);
    margin-top: var(--wa-space-2xs);
  }
`;
