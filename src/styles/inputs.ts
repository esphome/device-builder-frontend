/**
 * Shared input styling that matches the dashboard's search field —
 * adopted as the project-wide native-input look so every text/number/etc.
 * input across the app reads consistently.
 *
 * Components that need bespoke variants (search with a leading icon,
 * inline errors, etc.) can layer their own rules on top of these.
 */
import { css } from "lit";

/**
 * Compact search-field height, shared so the dashboard and navigator
 * searches stay in lockstep. Inline into whichever element draws the
 * border (the dashboard ``input``, the navigator ``.search`` wrapper).
 */
export const searchControlBox = css`
  min-height: var(--esphome-control-height);
  box-sizing: border-box;
`;

/** Search-field text sizing, paired with {@link searchControlBox} on the input. */
export const searchControlText = css`
  font-size: var(--wa-font-size-s);
  line-height: var(--wa-form-control-value-line-height);
`;

/**
 * Focus treatment shared by native inputs and the search wrappers that
 * carry the border themselves, so the focus ring stays in lockstep.
 */
export const inputFocusRing = css`
  border-color: var(--esphome-primary);
  box-shadow: var(--esphome-focus-ring);
`;

export const inputStyles = css`
  input[type="text"],
  input[type="number"],
  input[type="password"],
  input[type="email"],
  input[type="search"],
  input[type="tel"],
  input[type="url"],
  input:not([type]) {
    width: 100%;
    box-sizing: border-box;
    /* Match WA's form-control height token so native inputs and wa-select
       have identical outer dimensions (padding-block: 0; the explicit
       min-height + the line-height inside center the text). */
    min-height: var(--wa-form-control-height);
    padding: 0 14px;
    font-size: var(--wa-font-size-s);
    font-family: inherit;
    line-height: var(--wa-form-control-value-line-height);
    color: var(--wa-color-text-normal);
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    outline: none;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }

  input::placeholder {
    color: var(--wa-color-text-quiet);
  }

  input:focus {
    ${inputFocusRing}
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  input.invalid {
    border-color: var(--esphome-error);
  }

  input.invalid:focus {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--esphome-error), transparent 80%);
  }

  /* ── wa-select — share the same shape as native inputs ───────────── */

  wa-select::part(combobox) {
    /* WA already sets min-height: var(--wa-form-control-height) here, so
       the native inputs above (which use the same token) match the select
       outer dimensions exactly — we only override the chrome below. */
    padding: 0 14px;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    /* Kill WA's default focus outline so our primary-tinted box-shadow ring
       below is the only focus indicator. */
    outline: none;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }

  wa-select:focus-within::part(combobox) {
    border-color: var(--esphome-primary);
    outline: none;
    box-shadow: var(--esphome-focus-ring);
  }

  wa-select[disabled]::part(combobox) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  wa-select.invalid::part(combobox) {
    border-color: var(--esphome-error);
  }

  wa-select.invalid:focus-within::part(combobox) {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--esphome-error), transparent 80%);
  }

  wa-select::part(listbox) {
    padding-block: 0;
  }

  @media (hover: hover) {
    /* Tint hover with the text colour so it darkens in light mode and
       lightens in dark mode — --wa-color-surface-lowered goes the
       wrong way in dark mode (darker than the listbox bg). */
    wa-option:not([disabled]):is(:hover, :state(hover)):not(:state(current)) {
      background-color: color-mix(in srgb, var(--wa-color-text-normal), transparent 92%);
      color: var(--wa-color-text-normal);
    }
  }

  wa-option:state(current),
  wa-option[disabled]:state(current) {
    background-color: var(--esphome-tint);
    color: var(--wa-color-text-normal);
  }
`;
