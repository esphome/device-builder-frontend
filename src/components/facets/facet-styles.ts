/**
 * Shared visual language for the dashboard's faceted-filter row.
 *
 * Two components consume this stylesheet:
 *
 *  - ``<esphome-facet-filter>`` (generic single-value facets such as
 *    Area, Platform, Status — checkbox lists with no CRUD).
 *  - ``<esphome-labels-filter>`` (labels facet — same pill shape but
 *    adds inline rename / delete / create affordances inside the
 *    popover).
 *
 * Both render the same trigger pill (dashed when empty, solid + a
 * clear-icon when active) and the same popover shell (search field,
 * checkbox rows, footer link), so keeping the rules in one place
 * stops the two surfaces from drifting visually.
 */
import { css } from "lit";

export const facetStyles = css`
  /* ─── Trigger pill ───────────────────────────────────────────── */

  /* Trigger pill — dashed outline with a leading + icon and the
   * facet name. When selections exist, a vertical divider follows
   * the name and one or more removable badges render on the right:
   * up to 2 selections show individual badges with per-badge clear,
   * 3+ collapse to a single "N selected" count badge with clear-all.
   * The pill never switches to a solid outline; the badges carry
   * the active state on their own.
   */
  .facet-trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    /* Matches the 36px view-toggle / select-toggle squares so the
       toolbar row reads as one consistent control strip. */
    height: 36px;
    padding: 0 10px 0 12px;
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
    transition:
      background-color 0.12s,
      border-color 0.12s,
      color 0.12s;
  }

  /* Hover stays neutral on purpose — the trigger is one of several
     toolbar controls sitting in a row, and tinting it primary on
     hover made the whole strip feel busy. A subtle surface fill +
     darker border reads as "interactive" without competing with the
     active-state badges that already carry the facet's colour. */
  .facet-trigger:hover {
    background: color-mix(in srgb, var(--wa-color-text-normal), transparent 94%);
    border-color: color-mix(in srgb, var(--wa-color-text-normal), transparent 70%);
  }

  .facet-trigger:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--esphome-primary), transparent 70%);
  }

  /* Leading + icon — sits before the facet name in every state. */
  .facet-trigger-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: currentColor;
  }

  .facet-trigger-icon wa-icon {
    font-size: 16px;
  }

  /* Vertical divider between the facet name and the selection
     badges when the facet is active. */
  .facet-trigger-divider {
    width: 1px;
    height: 16px;
    background: var(--wa-color-surface-border);
    margin: 0;
  }

  /* Right-side container for the active-state badges. Wraps to a
     second row only when the badges would otherwise overflow —
     normally everything stays on one line. */
  .facet-trigger-badges {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 280px;
    overflow: hidden;
  }

  /* One badge per selected value (≤ 2) or a single count badge
     (> 2). Rounded-6 square corners (not pill) to differentiate
     from the trigger itself. */
  .facet-trigger-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 140px;
    padding: 2px 4px 2px 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
    color: var(--wa-color-text-normal);
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-semibold, 600);
    line-height: 1.4;
    white-space: nowrap;
  }

  .facet-trigger-badge-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* Inline × button — removes just this badge's value (single-
     selection mode) or clears the whole facet (count-badge mode).
     Stops the click from also toggling the popover. */
  .facet-trigger-badge-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: currentColor;
    padding: 0;
    cursor: pointer;
    opacity: 0.7;
    transition:
      opacity 0.12s,
      background-color 0.12s;
  }

  .facet-trigger-badge-remove:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--wa-color-text-normal), transparent 88%);
  }

  .facet-trigger-badge-remove:focus-visible {
    outline: none;
    opacity: 1;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--esphome-primary), transparent 60%);
  }

  .facet-trigger-badge-remove wa-icon {
    font-size: 10px;
  }

  /* ─── Popover shell ──────────────────────────────────────────── */

  .facet-popover {
    position: absolute;
    z-index: 10;
    top: calc(100% + 6px);
    left: 0;
    min-width: min(260px, calc(100vw - 32px));
    max-width: min(320px, calc(100vw - 32px));
    background: var(--wa-color-surface-default);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-l);
    box-shadow: var(--wa-shadow-m);
    padding: var(--wa-space-2xs);
    display: flex;
    flex-direction: column;
    gap: 0;
    max-height: 360px;
    overflow: hidden;
  }

  /* When the popover wraps a facet anchored against the right edge
     of the toolbar, callers add .facet-popover--anchor-right so it
     doesn't overflow into the off-screen area. */
  .facet-popover--anchor-right {
    left: auto;
    right: 0;
  }

  /* Search input lives at the top of the popover. Sized to match
     the surrounding row paddings — the magnifier icon overlays the
     left side via absolute positioning. */
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
    border-color: color-mix(in srgb, var(--esphome-primary), transparent 60%);
  }

  /* Scrollable list of rows. min-height: 0 lets it shrink inside
     the flex column so the footer / search stay pinned. */
  .facet-list {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  /* One row per option. Whole row is the click target; the count
     sits flush right. The active / hovered row gets a quiet
     surface fill so the user can sweep through options with the
     keyboard / mouse easily. */
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

  /* Empty state inside the popover (no options match the search /
     catalog is empty). Reads as a quiet status line, not a row. */
  .facet-empty {
    padding: var(--wa-space-m) var(--wa-space-s);
    text-align: center;
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  /* Footer link — "Clear filters". Sits below a divider as a quiet
     meta action. Rendered as a small centered text link rather than
     a full-width chunky button so it doesn't visually compete with
     the primary "Create new label" CTA that follows it in the
     labels-filter popover. */
  .facet-footer {
    border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    padding: var(--wa-space-2xs);
    flex-shrink: 0;
    display: flex;
    justify-content: center;
  }

  .facet-clear-link {
    background: transparent;
    border: none;
    padding: 4px 10px;
    border-radius: var(--wa-border-radius-s);
    color: var(--wa-color-text-quiet);
    font-family: inherit;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-normal, 400);
    cursor: pointer;
    text-align: center;
    transition:
      color 0.12s,
      background-color 0.12s;
  }

  .facet-clear-link:hover,
  .facet-clear-link:focus-visible {
    color: var(--wa-color-text-normal);
    background: color-mix(in srgb, var(--wa-color-text-normal), transparent 94%);
    outline: none;
  }
`;
