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
    padding: 9px 14px;
    font-size: var(--wa-font-size-s);
    font-family: inherit;
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
`;
