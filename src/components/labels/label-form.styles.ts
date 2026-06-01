import { css } from "lit";

/**
 * Styles for <esphome-label-form>. Extracted from the component
 * file to keep it under the repo's file-size cap (see README →
 * "Code structure policies"). The form pulls these in via its
 * ``static styles`` array alongside ``espHomeStyles``,
 * ``inputStyles``, and ``labelChipStyles``. Class names map to
 * the colour-swatch radiogroup, the name-suggestion chips, the
 * live label-chip preview stage, and the create / save action
 * buttons.
 */
export const labelFormStyles = css`
  :host {
    display: block;
  }

  .preview-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--wa-space-m) var(--wa-space-s);
    background: var(--wa-color-surface-lowered);
    border-radius: var(--wa-border-radius-l);
    border: var(--wa-border-width-s) dashed var(--wa-color-surface-border);
    min-height: 56px;
  }

  .preview-stage .label-chip {
    font-size: var(--wa-font-size-s);
    padding: 6px 14px;
    max-width: 100%;
    transition:
      background-color 0.18s,
      color 0.18s,
      border-color 0.18s;
  }

  .preview-stage .preview-placeholder {
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--wa-color-text-quiet);
  }

  .suggestions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: -10px;
  }

  .suggestions-label {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
  }

  .suggestions-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .suggestion-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-semibold);
    line-height: 1.4;
    border: var(--wa-border-width-s) solid transparent;
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    font-family: inherit;
    transition:
      background-color 0.12s,
      color 0.12s,
      transform 0.12s;
  }

  .suggestion-chip:hover {
    background: var(--suggestion-color, var(--wa-color-surface-lowered));
    color: var(--suggestion-fg, var(--wa-color-text-normal));
    transform: translateY(-1px);
  }

  .suggestion-chip:focus-visible {
    outline: none;
    box-shadow: var(--esphome-focus-ring-tight);
  }

  .suggestion-chip wa-icon {
    font-size: 11px;
  }

  .create-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
    border: var(--wa-border-width-s) dashed
      color-mix(in srgb, var(--esphome-primary), transparent 60%);
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--esphome-primary);
    cursor: pointer;
    align-self: stretch;
    justify-content: center;
    font-family: inherit;
    transition:
      background-color 0.15s,
      border-color 0.15s;
  }

  .create-toggle:hover {
    background: color-mix(in srgb, var(--esphome-primary), transparent 85%);
    border-color: color-mix(in srgb, var(--esphome-primary), transparent 40%);
  }

  .create-toggle wa-icon {
    font-size: 16px;
  }

  .create-form {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
  }

  .field-label {
    display: block;
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--wa-color-text-quiet);
    margin-bottom: var(--wa-space-2xs);
  }

  .form-header {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
  }

  .swatch-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .swatch {
    position: relative;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition:
      transform 0.12s ease,
      box-shadow 0.12s ease;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #000, transparent 88%);
  }

  .swatch:hover {
    transform: scale(1.08);
  }

  .swatch:focus-visible {
    outline: none;
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, #000, transparent 88%),
      var(--esphome-focus-ring);
  }

  .swatch--selected {
    box-shadow:
      inset 0 0 0 2px var(--wa-color-surface-default),
      0 0 0 2px currentColor;
  }

  .swatch wa-icon {
    font-size: 16px;
    line-height: 0;
  }

  .swatch--clear {
    background: var(--wa-color-surface-raised);
    color: var(--wa-color-text-quiet);
    border: var(--wa-border-width-s) dashed var(--wa-color-surface-border);
    box-shadow: none;
  }

  .swatch--clear:hover {
    color: var(--wa-color-text-normal);
    border-color: var(--wa-color-text-quiet);
  }

  .swatch--clear.swatch--selected {
    border-style: solid;
    border-color: var(--esphome-primary);
    color: var(--esphome-primary);
    box-shadow: var(--esphome-focus-ring-tight);
  }

  .create-actions {
    display: flex;
    gap: var(--wa-space-xs);
    justify-content: flex-end;
    margin-top: var(--wa-space-2xs);
  }

  .btn {
    padding: 8px 16px;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    border-radius: var(--wa-border-radius-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-raised);
    color: var(--wa-color-text-normal);
    cursor: pointer;
    font-family: inherit;
    transition:
      background-color 0.15s,
      border-color 0.15s;
  }

  .btn:hover {
    background: var(--wa-color-surface-lowered);
  }

  .btn--primary {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    border-color: var(--esphome-primary);
  }

  .btn--primary:hover {
    background: var(--esphome-primary-hover);
    border-color: var(--esphome-primary-hover);
  }

  .btn:disabled,
  .btn:disabled:hover {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--wa-color-surface-raised);
  }

  .btn--primary:disabled,
  .btn--primary:disabled:hover {
    background: var(--esphome-primary);
    border-color: var(--esphome-primary);
  }
`;
