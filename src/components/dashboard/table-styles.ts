import { css } from "lit";

/** Layout, header, body, scroll, select, and actions styles for the device table. */
export const tableLayoutStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-l) var(--wa-space-l) 0;
    margin-bottom: var(--wa-space-l);
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

  /* ─── Table ─── */

  .table-wrap {
    margin: 0 var(--wa-space-l) var(--wa-space-l);
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
      linear-gradient(to right, var(--wa-color-surface-raised) 30%, transparent) left center,
      linear-gradient(to left, var(--wa-color-surface-raised) 30%, transparent) right center,
      radial-gradient(farthest-side at 0 50%, rgba(0, 0, 0, 0.12), transparent) left center,
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
    background: color-mix(in srgb, var(--esphome-primary), transparent 95%);
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
    background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
  }

  tbody tr.selected .row-checkbox {
    color: var(--esphome-primary);
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
    width: 30px;
    height: 30px;
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
`;
