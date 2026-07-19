import { css } from "lit";

/**
 * Styles for `<esphome-options-combobox>`. Pulled in alongside
 * `inputStyles` (which draws the input chrome / form-control height);
 * these add the chevron overlay and the anchored option listbox.
 */
export const optionsComboboxStyles = css`
  :host {
    display: block;
  }

  .control {
    position: relative;
    display: block;
  }

  /* Leave room for the chevron sitting over the input's right edge. */
  input {
    padding-right: 34px;
  }

  .chevron {
    position: absolute;
    top: 0;
    right: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 32px;
    padding: 0;
    background: transparent;
    border: 0;
    color: var(--wa-color-text-quiet);
    font-size: 18px;
    cursor: pointer;
  }

  .chevron:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .listbox {
    max-height: 280px;
    overflow-y: auto;
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    box-shadow: var(--wa-shadow-m);
    padding: var(--wa-space-2xs);
  }

  .option {
    padding: var(--wa-space-2xs) var(--wa-space-s);
    border-radius: var(--wa-border-radius-s);
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
    cursor: pointer;
  }

  .option--active {
    background: var(--esphome-tint, var(--wa-color-surface-border));
  }

  .option-label {
    display: block;
  }
`;
