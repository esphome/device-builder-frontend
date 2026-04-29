/**
 * Shared input styling that matches the dashboard's search field —
 * adopted as the project-wide native-input look so every text/number/etc.
 * input across the app reads consistently.
 *
 * Components that need bespoke variants (search with a leading icon,
 * inline errors, etc.) can layer their own rules on top of these.
 */
import { css } from "lit";

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
    border-color: var(--esphome-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--esphome-primary), transparent 80%);
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
    box-shadow: 0 0 0 3px
      color-mix(in srgb, var(--esphome-primary), transparent 80%);
  }

  wa-select[disabled]::part(combobox) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  wa-select.invalid::part(combobox) {
    border-color: var(--esphome-error);
  }

  wa-select.invalid:focus-within::part(combobox) {
    box-shadow: 0 0 0 3px
      color-mix(in srgb, var(--esphome-error), transparent 80%);
  }
`;
