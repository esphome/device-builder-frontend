import { css } from "lit";

import { MOBILE_BREAKPOINT } from "../../styles/breakpoints.js";

/** Layout, header, body, scroll, select, and actions styles for the device table. */
export const tableLayoutStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    /* Row-end kebab button footprint; the stacked-card name padding
       derives its kebab clearance from this so the two can't drift. */
    --table-kebab-size: 30px;
  }

  /* Slotted content uses content-driven height — flex-shrink:0
     prevents the .table-device-count-row from collapsing below
     its intrinsic height when the column is tight, so the row's
     count + toggle stay legible while .table-wrap absorbs the
     remaining space. */
  ::slotted([slot="below-controls"]) {
    flex-shrink: 0;
  }

  /* When the dashboard's floating multi-select bar is visible, reserve
     space at the bottom of the table host so the pagination row sits
     above it rather than behind it. The bar pins itself to exactly
     --select-bar-height (with nowrap labels) so this reservation
     can't drift out of sync. */
  :host([select-mode]) {
    padding-bottom: var(--select-bar-height);
    box-sizing: border-box;
  }

  .controls {
    display: flex;
    /* Top-align the right-cluster (Columns + Create device) with
       the toolbar-stack's first row (search + view-toggle +
       facets). The slotted toolbar's right edge sits at the same
       y as Columns / Create. */
    align-items: flex-start;
    /* row-gap matches the card / YAML toolbars' .toolbar-row
       (row-gap: --wa-space-xs) so the vertical distance between the
       search row and the wrapped Filters/Columns/Create row is
       identical across all three views; column-gap stays --wa-space-s
       for the desktop single-row spacing. */
    gap: var(--wa-space-xs) var(--wa-space-s);
    /* Shared with the card view's .toolbar via tokens inherited from
       the dashboard host, so the two views keep identical gutters at
       every breakpoint (incl. the mobile trim). */
    padding: var(--toolbar-pad-top) var(--content-gutter) 0;
    /* No bottom margin: the below-controls slot now carries the
       device-count + Select-multiple row, and its own bottom
       padding handles spacing to the .table-wrap. Keeping the
       old --wa-space-l here would stack with the count row's
       padding into ~32px of dead space. */
    margin-bottom: 0;
    flex-shrink: 0;
  }

  .controls ::slotted([slot="toolbar"]) {
    flex: 1;
    min-width: 0;
  }

  .controls-right {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    flex-shrink: 0;
  }

  @media (max-width: 700px) {
    .controls {
      flex-wrap: wrap;
    }

    /* Row 1: search + view-toggle claim the full width. */
    .controls ::slotted([slot="toolbar"]) {
      flex: 1 1 100%;
    }

    /* Row 2: Filters + Columns + Create device share one line, packed
       at the left (margin-left was previously auto, which pinned the
       cluster to the right and left the dead space on the left). The
       buttons keep their natural width and the row never wraps; when
       space is tight (a long locale) Columns and Create shrink and
       ellipsize their labels rather than breaking to a second line.
       Filters keeps its short label (does not shrink). */
    .controls-right {
      flex: 1 1 100%;
      flex-wrap: nowrap;
      margin-left: 0;
      align-items: center;
      /* Tighter inter-button gap on the mobile row than the desktop
         cluster's --wa-space-s. */
      gap: var(--wa-space-xs);
    }

    .controls-right ::slotted([slot="before-columns"]) {
      flex: 0 0 auto;
    }

    .controls-right ::slotted([slot="actions"]) {
      flex: 0 1 auto;
      min-width: 0;
    }
  }

  /* ─── Table ─── */

  .table-wrap {
    /* Horizontal margin draws from the shared --content-gutter token
       (defined on the dashboard host, inherited here), so the table
       outline trims on mobile in lockstep with the .controls strip
       and the card view's grid. The bottom margin is a separate
       vertical step, trimmed in the @media block below. #41 */
    margin: 0 var(--content-gutter) var(--wa-space-l);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-l);
    overflow: hidden;
    background: var(--wa-color-surface-raised);
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .table-scroll {
    overflow: auto;
    flex: 1;
    min-height: 0;
    /* Horizontal scroll shadows — appear only when content overflows */
    background:
      linear-gradient(to right, var(--wa-color-surface-raised) 30%, transparent) left
        center,
      linear-gradient(to left, var(--wa-color-surface-raised) 30%, transparent) right
        center,
      radial-gradient(farthest-side at 0 50%, rgba(0, 0, 0, 0.12), transparent) left
        center,
      radial-gradient(farthest-side at 100% 50%, rgba(0, 0, 0, 0.12), transparent) right
        center;
    background-repeat: no-repeat;
    background-size:
      40px 100%,
      40px 100%,
      14px 100%,
      14px 100%;
    background-attachment: local, local, scroll, scroll;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--wa-font-size-xs);
  }

  /* ─── Header ─── */

  thead {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--wa-color-surface-lowered);
  }

  th {
    padding: 10px 14px;
    text-align: left;
    font-weight: var(--wa-font-weight-bold);
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    user-select: none;
  }

  th.sortable {
    cursor: pointer;
    transition: color 0.12s;
  }
  th.sortable:hover {
    color: var(--esphome-primary);
  }
  th.sorted {
    color: var(--esphome-primary);
  }

  .th-content {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .sort-icon {
    font-size: 14px;
    opacity: 0.4;
    transition: opacity 0.12s;
  }
  th.sorted .sort-icon {
    opacity: 1;
  }
  th.sortable:hover .sort-icon {
    opacity: 0.7;
  }

  /* ─── Body ─── */

  tbody tr {
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    transition: background 0.1s;
    cursor: pointer;
  }
  tbody tr:last-child {
    border-bottom: none;
  }
  tbody tr:hover {
    background: var(--esphome-tint-faint);
  }
  tbody tr:focus-visible {
    outline: 2px solid var(--esphome-primary);
    outline-offset: -2px;
  }

  td {
    padding: 11px 14px;
    color: var(--wa-color-text-normal);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 250px;
  }

  /* ─── Select / Checkbox ─── */

  .select-col {
    width: 40px;
    min-width: 40px;
    max-width: 40px;
    padding: 0;
    text-align: center;
    vertical-align: middle;
    overflow: visible;
  }

  .row-checkbox {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    cursor: pointer;
    color: var(--wa-color-text-quiet);
    transition: color 0.12s;
  }

  .row-checkbox:hover {
    color: var(--esphome-primary);
  }

  .row-checkbox wa-icon {
    font-size: 20px;
  }

  tbody tr.selected {
    background: var(--esphome-tint);
  }

  tbody tr.selected .row-checkbox {
    color: var(--esphome-primary);
  }

  /* Brief accent flash on a freshly-adopted row. The dashboard sets
     the highlight class for ~4s; the animation runs once during
     that window. Honours prefers-reduced-motion. */
  tbody tr.highlight {
    animation: row-highlight-glow 2s ease-out 1;
  }
  @keyframes row-highlight-glow {
    0% {
      background: color-mix(in srgb, var(--esphome-primary), transparent 70%);
    }
    100% {
      background: transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    tbody tr.highlight {
      animation: none;
      background: var(--esphome-tint);
    }
  }

  thead .row-checkbox {
    color: var(--wa-color-text-quiet);
  }

  /* ─── Actions column ─── */

  .actions-col {
    width: 40px;
    min-width: 40px;
    max-width: 40px;
    padding: 0;
    text-align: center;
    vertical-align: middle;
    overflow: visible;
  }

  .actions-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--table-kebab-size);
    height: var(--table-kebab-size);
    border: none;
    border-radius: var(--wa-border-radius-m);
    background: transparent;
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    padding: 0;
    transition:
      background 0.12s,
      color 0.12s;
  }

  .actions-btn:hover {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
  }

  .actions-btn wa-icon {
    font-size: 18px;
  }

  .no-results {
    text-align: center;
    padding: var(--wa-space-4xl) var(--wa-space-l);
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
  }

  /* Per-cell field label for the stacked mobile layout. Hidden on
     desktop (so it stays out of the a11y tree where the column header
     already labels the cell); shown on mobile by the media block. It's
     a real element rather than a ::before so screen readers announce it
     when the <thead> is hidden. */
  .cell-stack-label {
    display: none;
  }

  /* ─── Mobile: stacked-card layout ───
     On phones the desktop table doesn't fit (7+ columns, horizontal
     scroll only), so each row reflows into a card with one
     "label: value" line per cell (the label is .cell-stack-label,
     rendered from the column header in device-table.ts). The header
     row is hidden, so column sorting isn't available on mobile; the
     default sort applies, and a row tap still opens the drawer with
     full detail. #41 */
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    .table-wrap {
      margin-bottom: var(--wa-space-s);
    }

    /* Vertical scroll only; the horizontal-overflow shadows are moot. */
    .table-scroll {
      background: none;
    }

    thead {
      display: none;
    }

    table,
    tbody {
      display: block;
    }

    tbody tr {
      display: flex;
      flex-direction: column;
      position: relative;
      gap: 2px;
      margin: var(--wa-space-s);
      padding: var(--wa-space-s) var(--wa-space-m);
      border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      border-radius: var(--wa-border-radius-m);
      background: var(--wa-color-surface-default);
    }
    /* Desktop drops the last row's bottom border; restore it per card. */
    tbody tr:last-child {
      border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    }

    /* Data cells become label/value rows. */
    td:not(.no-results) {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: var(--wa-space-m);
      max-width: none;
      padding: 3px 0;
      border: none;
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
    }
    .cell-stack-label {
      display: inline;
      flex-shrink: 0;
      font-size: var(--wa-font-size-2xs);
      font-weight: var(--wa-font-weight-bold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--wa-color-text-quiet);
    }

    /* Name is the card title (first, larger, no label). The right pad
       reserves room for the absolutely-positioned kebab so a long name
       can't slide under it; derived from the kebab footprint so the two
       stay in sync. */
    td.col-name {
      order: -1;
      padding-right: calc(var(--table-kebab-size) + var(--wa-space-xs));
      padding-bottom: var(--wa-space-2xs);
    }
    td.col-name .cell-name {
      font-size: var(--wa-font-size-m);
      font-weight: var(--wa-font-weight-bold);
    }

    /* Inline actions become a button row at the bottom, divided off. */
    td.col-actions {
      order: 1;
      justify-content: flex-start;
      margin-top: var(--wa-space-xs);
      padding-top: var(--wa-space-s);
      border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    }

    /* Row-end kebab pins to the card's top-right corner. */
    td.actions-col {
      position: absolute;
      top: var(--wa-space-xs);
      right: var(--wa-space-xs);
      width: auto;
      min-width: 0;
      max-width: none;
      padding: 0;
    }

    /* Select checkbox sits at the top of the card. */
    td.select-col {
      order: -2;
      width: auto;
      min-width: 0;
      max-width: none;
      justify-content: flex-start;
    }
  }
`;
