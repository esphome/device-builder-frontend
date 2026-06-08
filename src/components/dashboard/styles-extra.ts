import { css } from "lit";

/**
 * Overflow rules extracted from dashboard styles to keep each file under the
 * 500-600 line cap. Composed immediately after `dashboardStyles` in the same
 * `static styles` array so the concatenated cascade order is unchanged.
 */
export const dashboardStylesExtra = css`
  /* Pairs the count with the Select-multiple toggle on a row of
     their own — both reference the device list, so they belong
     side-by-side. justify-content:space-between puts the count on
     the left and the toggle on the right at every width. */
  .device-count-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-m);
  }

  /* Table view slots the device-count-row through esphome-device-
     table's below-controls slot so the row spans the full table
     width and Select-multiple right-aligns with Columns / Create
     device in the row above. Horizontal padding matches .controls
     and .table-wrap above/below so the count and toggle line up
     with the column headers on the right. 2px top padding mirrors
     card view's .toolbar gap so the inter-row spacing reads
     identically between views. Horizontal padding and top gap draw
     from the shared --content-gutter / --toolbar-row-gap tokens, so
     the count row trims on mobile and lines up with the toolbar
     above it without a separate @media rule. */
  .table-device-count-row {
    padding: var(--toolbar-row-gap) var(--content-gutter) var(--wa-space-xs);
  }

  /* ─── View Toggle ─── */

  .view-toggle {
    display: inline-flex;
    border-radius: var(--wa-border-radius-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    overflow: hidden;
    flex-shrink: 0;
  }

  .view-toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--esphome-control-height);
    height: var(--esphome-control-height);
    border: none;
    background: var(--wa-color-surface-raised);
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s;
    padding: 0;
  }

  .view-toggle-btn + .view-toggle-btn {
    border-left: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .view-toggle-btn:hover {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
  }

  .view-toggle-btn.active {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .view-toggle-btn.active:hover {
    background: var(--esphome-primary-hover);
  }

  .view-toggle-btn wa-icon {
    font-size: 18px;
  }

  /* "Select multiple devices" toggle. Lives in the results row,
   * styled as a quiet text-link with a leading icon — secondary to
   * the filter pills above. Active state flips to primary so the
   * mode-change reads at a glance. */
  .select-toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    border-radius: var(--wa-border-radius-m);
    border: var(--wa-border-width-s) solid transparent;
    background: transparent;
    color: var(--wa-color-text-quiet);
    font-family: inherit;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold, 600);
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s,
      border-color 0.12s;
    flex-shrink: 0;
  }

  .select-toggle-btn:hover {
    background: color-mix(in srgb, var(--wa-color-text-normal), transparent 94%);
    color: var(--wa-color-text-normal);
  }

  .select-toggle-btn:focus-visible {
    outline: none;
    color: var(--wa-color-text-normal);
    box-shadow: var(--esphome-focus-ring-tight);
  }

  .select-toggle-btn.active {
    background: var(--esphome-tint);
    color: var(--esphome-primary);
    border-color: var(--esphome-tint-border);
  }

  .select-toggle-btn.active:hover {
    background: var(--esphome-tint-strong);
  }

  .select-toggle-btn wa-icon {
    font-size: 15px;
  }

  .select-toggle-btn-label {
    line-height: 1;
  }

  /* ─── Empty search state ─── */

  .empty-search {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-4xl) var(--wa-space-l);
    text-align: center;
  }
  .empty-search-icon {
    font-size: 48px;
    color: color-mix(in srgb, var(--esphome-primary), transparent 60%);
    line-height: 1;
  }
  .empty-search-title {
    margin: 0;
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }
  .empty-search-desc {
    margin: 0;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    max-width: 320px;
  }
  .empty-search-clear {
    margin-top: var(--wa-space-xs);
    background: none;
    border: var(--wa-border-width-s) solid var(--esphome-primary);
    color: var(--esphome-primary);
    padding: 6px 16px;
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-s);
    font-family: inherit;
    font-weight: var(--wa-font-weight-bold);
    cursor: pointer;
    transition: background 0.12s;
  }
  .empty-search-clear:hover {
    background: var(--esphome-tint);
  }

  /* ─── Skeleton ─── */

  @keyframes skeleton-shimmer {
    from {
      background-position: -400px 0;
    }
    to {
      background-position: 400px 0;
    }
  }
  .skeleton-card {
    border-radius: var(--wa-border-radius-l);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-raised);
    overflow: hidden;
    min-height: 130px;
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
    padding: var(--wa-space-m);
  }
  .skeleton-line {
    border-radius: var(--wa-border-radius-m);
    background: linear-gradient(
      90deg,
      var(--wa-color-surface-border) 25%,
      color-mix(
          in srgb,
          var(--wa-color-surface-border),
          var(--wa-color-surface-raised) 60%
        )
        50%,
      var(--wa-color-surface-border) 75%
    );
    background-size: 800px 100%;
    animation: skeleton-shimmer 1.4s infinite linear;
  }
  .skeleton-line--title {
    height: 18px;
    width: 55%;
  }
  .skeleton-line--subtitle {
    height: 13px;
    width: 35%;
  }
  .skeleton-line--actions {
    height: 30px;
    width: 100%;
    margin-top: auto;
  }

  /* ─── Table Skeleton ─── */

  .skeleton-table {
    margin: var(--wa-space-l);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-l);
    overflow: hidden;
    background: var(--wa-color-surface-raised);
    flex: 1;
    min-height: 0;
  }

  .skeleton-table-header {
    display: flex;
    gap: var(--wa-space-l);
    padding: 14px var(--wa-space-l);
    background: var(--wa-color-surface-lowered);
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .skeleton-table-row {
    display: flex;
    gap: var(--wa-space-l);
    padding: 14px var(--wa-space-l);
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .skeleton-table-row:last-child {
    border-bottom: none;
  }

  .skeleton-line--header {
    height: 12px;
    width: 100px;
  }

  .skeleton-line--cell {
    height: 14px;
    flex: 1;
  }

  .skeleton-line--cell:first-child {
    max-width: 16px;
    border-radius: 50%;
    height: 16px;
    flex: none;
  }

  /* ─── Add New Device Card ─── */

  .add-device-card {
    border: 2px dashed color-mix(in srgb, var(--esphome-primary), transparent 50%);
    border-radius: var(--wa-border-radius-l);
    padding: var(--wa-space-xl) var(--wa-space-l);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--wa-space-m);
    background: var(--esphome-tint-faint);
    min-height: 200px;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s,
      transform 0.15s;
  }
  .add-device-card:hover {
    border-color: var(--esphome-primary);
    background: var(--esphome-tint);
    transform: translateY(-2px);
  }
  .add-device-icon-wrap {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--esphome-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 14px color-mix(in srgb, var(--esphome-primary), transparent 50%);
    transition:
      box-shadow 0.15s,
      transform 0.15s;
  }
  .add-device-card:hover .add-device-icon-wrap {
    box-shadow: 0 6px 20px color-mix(in srgb, var(--esphome-primary), transparent 35%);
    transform: scale(1.06);
  }
  .add-device-icon-wrap wa-icon {
    font-size: 26px;
    color: var(--esphome-on-primary);
  }
  .add-device-label {
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--esphome-primary);
  }
  .add-device-hint {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    text-align: center;
  }
  .esphome-web-link {
    display: flex;
    align-items: center;
    gap: var(--wa-space-2xs);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    text-decoration: none;
    margin-top: var(--wa-space-2xs);
  }
  .esphome-web-link wa-icon {
    font-size: 14px;
  }
  .esphome-web-link:hover {
    color: var(--esphome-primary);
  }

  /* ─── Table Create Button ─── */

  .table-create-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    height: 36px;
    box-sizing: border-box;
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    cursor: pointer;
    border: none;
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    transition: background 0.12s;
    /* Keeps its natural width; on mobile's single-row toolbar
       (table-styles.ts) it may only shrink, never grow. min-width:0 +
       the label ellipsis below let it ellipsize instead of wrapping
       the row in a long locale. */
    min-width: 0;
  }

  .table-create-btn:hover {
    background: var(--esphome-primary-hover);
  }

  .table-create-btn wa-icon {
    font-size: 15px;
    flex-shrink: 0;
  }

  .table-create-btn .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* Flex item must allow shrinking below its intrinsic width or the
       ellipsis never triggers when the mobile row gets tight. */
    min-width: 0;
  }

  /* Tighter horizontal padding on the mobile toolbar row so the three
     controls sit more compactly (matches the Columns toggle). */
  @media (max-width: 700px) {
    .table-create-btn {
      padding: 0 10px;
    }
  }

  /* ─── FAB ─── */

  .fab-container {
    position: fixed;
    bottom: var(--fab-bottom);
    right: var(--wa-space-xl);
    z-index: 10;
  }
  .fab-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-xs);
    padding: 12px 22px;
    border-radius: 999px;
    border: none;
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    cursor: pointer;
    box-shadow:
      0 4px 14px color-mix(in srgb, var(--esphome-primary), transparent 40%),
      0 2px 4px rgba(0, 0, 0, 0.12);
    transition:
      transform 0.15s,
      box-shadow 0.15s,
      background 0.15s;
    letter-spacing: 0.01em;
  }
  .fab-btn:hover {
    background: var(--esphome-primary-hover);
    transform: translateY(-2px);
    box-shadow:
      0 8px 24px color-mix(in srgb, var(--esphome-primary), transparent 30%),
      0 4px 8px rgba(0, 0, 0, 0.14);
  }
  .fab-btn:active {
    transform: translateY(0);
  }
  .fab-btn wa-icon {
    font-size: 18px;
  }
`;
