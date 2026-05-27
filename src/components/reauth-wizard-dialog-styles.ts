import { css } from "lit";

/**
 * Styles for the reauth wizard dialog. Extracted so the
 * dialog component stays under the project's 500-600 line
 * cap; the visual layer is unchanged from before the split.
 *
 * The dialog component combines this with espHomeStyles,
 * pinHexStyles, and dialogActionButtonStyles in its static
 * styles array.
 */
export const reauthWizardDialogStyles = css`
  esphome-base-dialog {
    --width: 560px;
  }

  /* Step-progress dots sit at the top of the body. The
     pre-migration shape rendered them inside the slot=label
     header next to the wizard title; base-dialog's .label
     property only takes a string, so the indicator moved
     into the body where it reads as the first row above the
     step content. Wizard title still renders in the dialog
     header via the .label property. */
  .step-indicator {
    display: flex;
    gap: 6px;
    align-items: center;
    padding-bottom: var(--wa-space-s);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--wa-color-surface-border);
  }

  .dot-active {
    background: var(--esphome-primary);
  }

  .step-body {
    padding: var(--wa-space-s) 0;
  }

  .lede {
    margin: 0 0 var(--wa-space-m);
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
  }

  .pin-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--wa-space-m);
  }

  .pin-block {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
    padding: var(--wa-space-s) var(--wa-space-m);
    background: var(--wa-color-surface-lowered);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
  }

  .pin-block-solo {
    max-width: 320px;
  }

  .pin-block-label {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--wa-color-text-quiet);
  }

  .pin-block-label-observed {
    color: var(--esphome-warning, #f59e0b);
  }

  .possibilities {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--wa-space-m);
  }

  .possibility {
    padding: var(--wa-space-s) var(--wa-space-m);
    border-radius: var(--wa-border-radius-m);
    border-left: 3px solid;
  }

  .possibility-benign {
    background: color-mix(in srgb, var(--esphome-success), transparent 92%);
    border-left-color: var(--esphome-success);
  }

  .possibility-malign {
    background: color-mix(in srgb, var(--esphome-error), transparent 92%);
    border-left-color: var(--esphome-error);
  }

  .possibility-title {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    margin-bottom: var(--wa-space-2xs);
  }

  .possibility-body {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
  }

  .verify-row {
    display: flex;
    align-items: flex-start;
    gap: var(--wa-space-s);
    margin-top: var(--wa-space-m);
    padding: var(--wa-space-s) var(--wa-space-m);
    background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 92%);
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-s);
    cursor: pointer;
  }

  .verify-row input {
    margin-top: 2px;
  }

  /* Step-3 inline error block. Renders when request_pair
     returned a retryable failure (NO_PAIRING_WINDOW /
     UNAVAILABLE / generic). The wizard keeps step 3 open so
     the operator's verification still binds across the retry
     -- the primary action button below retitles to 'Try
     again' (or 'Re-pairing...' while busy). Uses the warning
     palette like .verify-row but a touch louder. */
  .step-error {
    margin-top: var(--wa-space-m);
    padding: var(--wa-space-s) var(--wa-space-m);
    border-left: 3px solid var(--wa-color-warning-fill-loud);
    background: color-mix(in srgb, var(--wa-color-warning-fill-loud), transparent 88%);
    border-radius: var(--wa-border-radius-s);
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--wa-space-s);
    margin-top: var(--wa-space-m);
  }

  /* Back is .btn--cancel's neutral chrome with a distinct
     class name so the markup self-documents which row slot
     the button is. dialogActionButtonStyles paints
     .btn--cancel; this rule extends the same chrome to
     .btn--back without re-declaring it. */
  .btn--back {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .btn--back:hover:not(:disabled) {
    background: var(--wa-color-surface-border);
  }
`;
