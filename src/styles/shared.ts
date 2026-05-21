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
