import { css } from "lit";

/**
 * Styles for <esphome-add-automation-dialog>. Extracted from the
 * component file to keep it under the repo's file-size cap (see
 * README → "Code structure policies"). The component pulls these
 * in via its ``static styles`` array alongside ``espHomeStyles`` and
 * ``inputStyles``.
 */
export const addAutomationDialogStyles = css`
  esphome-base-dialog {
    --width: 560px;
  }
  esphome-base-dialog::part(body) {
    padding: var(--wa-space-l);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    margin-bottom: var(--wa-space-m);
  }
  .field-label {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
  }
  .field-desc {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
    margin: 0;
  }
  .field-desc a {
    color: var(--wa-color-brand-fill-loud, #0b5cad);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--wa-space-s);
    margin-top: var(--wa-space-l);
  }

  .actions button {
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    gap: 3px;
    padding: 7px 14px;
    border: var(--wa-border-width-s) solid transparent;
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    line-height: 1;
    transition:
      background 0.12s,
      border-color 0.12s,
      box-shadow 0.12s,
      transform 0.12s;
  }
  .actions .primary {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    box-shadow: var(--esphome-primary-shadow);
  }
  .actions .primary:hover:not(:disabled) {
    background: var(--esphome-primary-hover);
    box-shadow: var(--esphome-primary-shadow-hover);
    transform: translateY(-1px);
  }
  .actions .primary:active:not(:disabled) {
    transform: translateY(0);
  }
  .actions .primary:disabled {
    background: color-mix(
      in srgb,
      var(--esphome-primary) 35%,
      var(--wa-color-surface-default)
    );
    color: color-mix(in srgb, var(--esphome-on-primary), transparent 30%);
    cursor: not-allowed;
    box-shadow: none;
    transform: none;
  }
  .error {
    color: var(--esphome-error, #d92d20);
    font-size: var(--wa-font-size-2xs);
    margin-top: var(--wa-space-2xs);
  }
  .intro {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    margin: 0 0 var(--wa-space-m) 0;
    line-height: 1.5;
  }
  /* Interval-row pairing: matches the editor's inline
     TIME_PERIOD layout so the dialog reads as the same
     kind of compound input the user will see again in the
     section editor. */
  .interval-inputs {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
  }
  .interval-inputs > input {
    flex: 1 1 auto;
    min-width: 0;
  }
  .interval-inputs > wa-select {
    flex: 0 0 auto;
    min-width: 6rem;
  }
`;
