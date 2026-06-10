/**
 * Shared visual language for the dashboard's Filters popover.
 *
 * Three components consume this stylesheet:
 *
 *  - ``<esphome-filters-popover>`` (the single toolbar trigger +
 *    popover shell hosting the accordion sections).
 *  - ``<esphome-filter-section>`` (generic checkbox-list sections
 *    such as Area, Platform, Status, Updates).
 *  - ``<esphome-labels-filter-section>`` (labels section — same row
 *    shape but adds chips and rename / delete / create affordances).
 *
 * Keeping the trigger pill and the row / search rules in one
 * place stops the surfaces from drifting visually.
 */
import { css } from "lit";

export const filterStyles = css`
  /* ─── Trigger pill ───────────────────────────────────────────── */

  .facet-trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    /* Shared with the search input / view-toggle so the toolbar
       row reads as one consistent control strip. */
    min-height: var(--esphome-control-height);
    padding: 4px 10px 4px 12px;
    border-radius: var(--wa-border-radius-m);
    /* 2px dashes — the default 1px-thick dashed border renders as
       almost-solid hairline on hidpi displays, especially against
       muted surface tokens. 2px keeps each segment visibly distinct. */
    border: 2px dashed var(--wa-color-surface-border);
    background: transparent;
    color: var(--wa-color-text-normal);
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold, 600);
    cursor: pointer;
    flex-shrink: 0;
    max-width: 100%;
    box-sizing: border-box;
    transition:
      background-color 0.12s,
      border-color 0.12s,
      color 0.12s;
  }

  .facet-trigger-name {
    flex-shrink: 0;
  }

  /* Hover stays neutral on purpose — the trigger is one of several
     toolbar controls sitting in a row, and tinting it primary on
     hover made the whole strip feel busy. */
  .facet-trigger:hover {
    background: color-mix(in srgb, var(--wa-color-text-normal), transparent 94%);
    border-color: color-mix(in srgb, var(--wa-color-text-normal), transparent 70%);
  }

  .facet-trigger:focus-visible {
    outline: none;
    box-shadow: var(--esphome-focus-ring-tight);
  }

  .facet-trigger-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: currentColor;
  }

  .facet-trigger-icon wa-icon {
    font-size: 16px;
  }

  /* ─── Search field ───────────────────────────────────────────── */

  /* Search input lives at the top of a section body. The magnifier
     icon overlays the left side via absolute positioning. */
  .facet-search {
    position: relative;
    padding: 4px;
    flex-shrink: 0;
  }

  .facet-search-icon {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--wa-color-text-quiet);
    font-size: 16px;
    pointer-events: none;
  }

  .facet-search-input {
    width: 100%;
    height: 32px;
    padding: 0 10px 0 32px;
    border: var(--wa-border-width-s) solid transparent;
    border-radius: var(--wa-border-radius-m);
    background: transparent;
    color: var(--wa-color-text-normal);
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    box-sizing: border-box;
  }

  .facet-search-input::placeholder {
    color: var(--wa-color-text-quiet);
  }

  .facet-search-input:focus {
    outline: none;
    border-color: var(--esphome-tint-border);
  }

  /* ─── Option rows ────────────────────────────────────────────── */

  /* Scrollable list of rows. min-height: 0 lets it shrink inside
     the flex column so the search / create CTA stay pinned. */
  .facet-list {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  /* One row per option. Whole row is the click target; the count
     sits flush right. */
  .facet-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    background: transparent;
    border: none;
    color: inherit;
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    text-align: left;
    width: 100%;
    transition: background-color 0.1s;
  }

  .facet-row:hover,
  .facet-row:focus-visible {
    background: color-mix(in srgb, var(--wa-color-text-normal), transparent 94%);
    outline: none;
  }

  .facet-row[aria-checked="true"] .facet-row-name {
    font-weight: var(--wa-font-weight-semibold, 600);
  }

  /* Checkbox cell — square outline by default, primary-fill +
     check icon when the row is selected. */
  .facet-row-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    flex-shrink: 0;
    background: transparent;
    color: var(--esphome-on-primary);
    transition:
      background-color 0.1s,
      border-color 0.1s;
  }

  .facet-row[aria-checked="true"] .facet-row-check {
    background: var(--esphome-primary);
    border-color: var(--esphome-primary);
  }

  .facet-row-check wa-icon {
    font-size: 12px;
  }

  .facet-row-name {
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .facet-row-count {
    flex-shrink: 0;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-xs);
    font-variant-numeric: tabular-nums;
  }

  /* Empty state inside a section (no options match the search /
     catalog is empty). Reads as a quiet status line, not a row. */
  .facet-empty {
    padding: var(--wa-space-m) var(--wa-space-s);
    text-align: center;
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }
`;
