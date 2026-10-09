import { css } from "lit";

/**
 * Styles for <esphome-adopt-dialog>: the description, the configuration
 * source box, the name pair with its rename hint, and the encryption row.
 * Dialog chrome, inputs and the shared .btn shapes come from the shared
 * style modules the component lists before this block.
 */
export const adoptDialogStyles = css`
  esphome-base-dialog {
    --width: 460px;
  }

  esphome-base-dialog::part(body) {
    padding: 0 var(--wa-space-l);
  }

  .description {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
    margin: 0 0 var(--wa-space-m);
    line-height: 1.5;
  }

  /* Surface the package_import_url so the user can see where
     the adoption flow is fetching its YAML / Python from.
     Most "Made for ESPHome" firmware advertises this routinely
     (Athom, Apollo, etc.), so neutral informational treatment
     rather than a warning. The user can still notice if the
     hostname looks unfamiliar. See
     esphome/device-builder#120 finding B-2. */
  .source-info {
    margin-bottom: var(--wa-space-m);
  }

  .source-info-label {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
    margin-bottom: var(--wa-space-2xs);
  }

  /* Show the URL in monospace; long URLs wrap inside the
     dialog instead of overflowing or getting truncated. The
     word-break:break-word + overflow-wrap:anywhere pair
     (same one yaml-diff.ts and ansi-log.ts use) breaks only
     on the longest unbreakable run rather than mid-token —
     hostnames stay intact, which matters here because the
     hostname is the highest-signal part for deciding trust.
     break-all would happily split github.com across two
     lines and hide the signal. */
  .source-info-url {
    font-family: var(--wa-font-family-code);
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-normal);
    word-break: break-word;
    overflow-wrap: anywhere;
    background: var(--wa-color-surface-lowered);
    padding: 6px 10px;
    border-radius: var(--wa-border-radius-s);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    display: block;
  }

  /* Anchor variant of the URL block for when the value is a
     recognised github / gitlab / codeberg shorthand and we can
     resolve a clickable browse URL. Same monospace + wrap shape
     as the plain-text variant; just adds hover affordance and
     the primary-colour underline so the user can tell it's
     interactive. */
  a.source-info-url {
    color: var(--esphome-primary);
    text-decoration: none;
  }

  a.source-info-url:hover {
    text-decoration: underline;
  }

  a.source-info-url:focus-visible {
    outline: 2px solid var(--esphome-primary-light);
    outline-offset: 2px;
  }

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

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding-bottom: var(--wa-space-m);
  }

  .checkbox-label {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-s);
    cursor: pointer;
    user-select: none;
  }

  .checkbox-link {
    font-size: var(--wa-font-size-xs);
  }

  .checkbox-title {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  /* The inline hostname field ends on its own field padding; the
     hint pulls back up under the input it describes. */
  .name-hint {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    margin: calc(-1 * var(--wa-space-s)) 0 var(--wa-space-m);
  }

  /* Adoption's commit affordance is success-green rather than the
     standard primary tint (dialogActionButtonStyles); per that
     module's guidance, divergent colour intents stay local. This
     block sits after the shared fragment so it wins the cascade. */
  .btn--primary {
    background: var(--esphome-success);
  }

  .btn--primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--esphome-success), black 10%);
  }

  .field-error {
    color: var(--esphome-error);
    font-size: var(--wa-font-size-xs);
    margin-top: var(--wa-space-2xs);
  }

  .submit-error {
    color: var(--esphome-error);
    font-size: var(--wa-font-size-xs);
    padding-bottom: var(--wa-space-s);
  }
`;
