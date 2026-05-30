/**
 * Shared CSS styles for ESPHome frontend components.
 *
 * Only ESPHome-specific brand tokens live here.
 * For typography, spacing, borders, shadows, and transitions use the
 * WebAwesome design tokens directly:  --wa-font-size-*, --wa-space-*,
 * --wa-border-radius-*, --wa-shadow-*, --wa-transition-*, etc.
 */
import { css } from "lit";

/** ESPHome brand colors and design tokens. */
export const espHomeStyles = css`
  :host {
    /* ─── Brand colors ─── */
    --esphome-primary: var(--primary-color, #009fee);
    --esphome-primary-light: color-mix(
      in srgb,
      var(--primary-color, #009fee) 12%,
      transparent
    );
    --esphome-secondary: color-mix(in srgb, var(--primary-color, #009fee), black 8%);
    --esphome-success: #2ecc71;
    --esphome-warning: #f39c12;
    --esphome-error: #e74c3c;
    --esphome-offline: #95a5a6;

    /* Text color for use on primary / dark / colored backgrounds — white in both light and dark modes */
    --esphome-on-primary: var(--text-primary-color, #ffffff);

    /* ─── Layout ─── */
    --esphome-header-height: 56px;
    --esphome-footer-height: 20px;

    font-family: var(--wa-font-family-body);
  }

  /* ─── Custom wa-button variants ─── */

  /* variant="primary": solid --esphome-secondary background, white text */
  wa-button[variant="primary"]::part(base) {
    background-color: var(--esphome-secondary);
    border-color: var(--esphome-secondary);
    color: var(--esphome-on-primary);
  }

  wa-button[variant="primary"]::part(base):hover {
    background-color: color-mix(in srgb, var(--esphome-secondary), black 10%);
    border-color: color-mix(in srgb, var(--esphome-secondary), black 10%);
  }

  /* variant="light": --esphome-primary-light background, --esphome-primary text */
  wa-button[variant="light"]::part(base) {
    background-color: var(--esphome-primary-light);
    color: var(--esphome-primary);
  }

  wa-button[variant="light"]::part(base):hover {
    background-color: color-mix(in srgb, var(--esphome-primary-light), black 5%);
  }

  /* ─── Inline markdown rendering ─── */
  /* Used by util/markdown.ts for links and inline code inside any
     description (config field, board, component, section). */
  .md-link {
    color: var(--esphome-primary);
    text-decoration: underline;
  }

  .md-link:hover {
    text-decoration: none;
  }

  .md-code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.92em;
    padding: 0 var(--wa-space-2xs);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
    /* Keep long path-like code from breaking the line awkwardly. */
    word-break: break-word;
  }
`;

/**
 * Selection-dialog option cards.
 *
 * Shared by the dialogs that present a vertical list of clickable
 * option rows (icon? + title + description + trailing chevron) inside
 * an <esphome-base-dialog> with the compact primary header — currently
 * the install-method picker and the firmware-format picker. Lives here
 * so the card chrome is defined once; each dialog keeps only its own
 * extras (leading-icon sizing, disabled/collapsible variants, forms)
 * local. The hover rule excludes ``.option--disabled`` so disabled rows
 * (install dialog) don't light up; the download dialog has none, so the
 * exclusion is a no-op there.
 */
export const dialogOptionStyles = css`
  esphome-base-dialog {
    --width: 460px;
  }

  esphome-base-dialog::part(header) {
    background: var(--esphome-primary);
    padding: 0 var(--wa-space-m);
    height: 40px;
    box-sizing: border-box;
  }

  esphome-base-dialog::part(title) {
    color: var(--esphome-on-primary);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
  }

  esphome-base-dialog::part(body) {
    padding: var(--wa-space-l);
  }

  esphome-base-dialog::part(footer) {
    display: none;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
  }

  .option {
    display: flex;
    align-items: center;
    gap: var(--wa-space-m);
    padding: var(--wa-space-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-l);
    cursor: pointer;
    transition:
      background 0.12s,
      border-color 0.12s;
  }

  .option:hover:not(.option--disabled) {
    background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
    border-color: var(--esphome-primary);
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .title {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .desc {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    line-height: 1.4;
  }

  .option-chevron {
    margin-left: auto;
    font-size: 20px;
    color: var(--wa-color-text-quiet);
    flex-shrink: 0;
    transition: color 0.12s;
  }

  .option:hover .option-chevron {
    color: var(--esphome-primary);
  }
`;

/** Common layout helpers. */
export const layoutStyles = css`
  .page-content {
    padding: var(--wa-space-l);
    max-width: 1200px;
    margin: 0 auto;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: var(--wa-space-m);
  }

  .flex-row {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
  }

  .flex-col {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
  }

  .spacer {
    flex: 1;
  }
`;
