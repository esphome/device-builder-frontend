import { css } from "lit";

import { MOBILE_BREAKPOINT } from "../../styles/breakpoints.js";

/** Dashboard shell layout, search toolbar, view toggle, and empty-search state. */
export const dashboardStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    position: relative;
    box-sizing: border-box;
    /* vh fallback then dvh: on mobile 100vh is the large viewport, which
       makes this fixed-height (internal-scroll) container taller than the
       visible area — the pagination row and the fixed footer drop below
       the fold and the page over-scrolls. dvh tracks the visible viewport
       so the table fills exactly header→footer and the inner .table-scroll
       still scrolls. Matches the vh/dvh pairing in device-styles.ts. */
    height: calc(100vh - var(--esphome-header-height) - var(--esphome-footer-height));
    height: calc(100dvh - var(--esphome-header-height) - var(--esphome-footer-height));
    overflow: hidden;
    /* Single source of truth for the floating Create-device button's
       footprint. --fab-bottom is the gap between the FAB and the
       viewport edge (also the FAB's CSS bottom); --fab-height
       approximates the rendered button height (12+12px padding plus
       text). The card grid pads its bottom by their sum so the
       trailing card's action row never sits under the FAB. Defining
       these once stops the grid clearance and the FAB position from
       drifting if either gets tweaked later. The fab-bottom also
       includes the footer height so the FAB clears the version line. */
    --fab-bottom: calc(var(--wa-space-l) + var(--esphome-footer-height));
    --fab-height: 48px;
    --fab-clearance: calc(var(--fab-bottom) + var(--fab-height) + var(--wa-space-xs));
    /* Height of the floating multi-select action bar (rendered by
       esphome-select-bar at position:fixed; bottom:0). Used both to
       enforce the bar's own height and to reserve clearance inside
       the device table so its pagination row doesn't sit beneath it. */
    --select-bar-height: 64px;
    /* Outer padding for the search toolbar, shared between the card
       view's .toolbar and the table view's .controls. .controls lives
       in esphome-device-table's shadow but inherits these from the
       dashboard host, so both toolbars resolve identical values and
       can't drift on mobile. Mobile override is in the @media block. */
    --toolbar-pad-top: var(--wa-space-l);
    /* --content-gutter (the horizontal inset shared by the toolbar, card
       grid, YAML hit list, table outline, and count row) is defined once on
       esphome-layout's :host and inherited here, so the header and the body
       share one gutter. The device-table shadow inherits it too. #41 */
    /* Inter-row gap inside the toolbar. Card view's .toolbar and the
       table view's .toolbar-stack both use it, and the table count
       row mirrors it as padding-top, so the rows line up identically
       when toggling between views. Matches .toolbar-row's wrap
       row-gap so every stacked toolbar row (search, wrapped Filters,
       count) shares one even gap when the controls wrap on mobile. */
    --toolbar-row-gap: var(--wa-space-xs);
  }

  /* YAML mode renders over any underlying view, so it shares this
     scroll override; without it, YAML search opened from table view
     clips its hit list. Padding clears the fixed, opaque footer. */
  :host([view="cards"]),
  :host([yaml]) {
    height: auto;
    overflow: visible;
    padding-bottom: var(--esphome-footer-height);
  }

  /* When the discovered banner is present, push toolbar / content
     down so the collapsed pill doesn't sit on top of the view-toggle
     buttons.*/
  :host([has-discovered]) {
    padding-top: var(--wa-space-xl);
  }

  /* Mobile compacts the pill further (see .discovered-section-header
     @media block below), so the gutter tightens one more step to
     match the smaller pill. #41 */
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    :host([has-discovered]) {
      padding-top: var(--wa-space-l);
    }

    /* Tighten the toolbar's top padding on mobile (the --content-gutter
       mobile trim lives on esphome-layout now, inherited here). #41 */
    :host {
      --toolbar-pad-top: var(--wa-space-s);
    }
  }

  /* ─── Search toolbar ─── */

  .toolbar {
    display: flex;
    flex-direction: column;
    gap: var(--toolbar-row-gap);
    padding: var(--toolbar-pad-top) var(--content-gutter) 0;
    flex-shrink: 0;
  }

  /* Table-view counterpart to .toolbar (sits inside the
     device-table's named toolbar slot, where the slotted rule on
     .controls handles the outer padding). Without this rule the
     inner rows stacked at 0px gap while card view stacked at 2px,
     so flipping the view-toggle made the X-devices row jump 2px
     vertically. Both gaps draw from --toolbar-row-gap so they
     can't drift apart. */
  .toolbar-stack {
    display: flex;
    flex-direction: column;
    gap: var(--toolbar-row-gap);
  }

  .toolbar-row {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    flex-wrap: wrap;
    row-gap: var(--wa-space-xs);
  }

  /* Wraps the Filters-menu button in the toolbar control strip. */
  .filter-group {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--wa-space-2xs);
    row-gap: var(--wa-space-2xs);
    flex-shrink: 1;
    min-width: 0;
  }

  /* The <form role="search"> wrapper is what suppresses Chrome's
     credential autofill on the search input; display: contents keeps
     it out of the layout so the absolute-positioned leading icon
     still aligns. */
  .search-form {
    display: contents;
  }

  .search-wrap {
    position: relative;
    max-width: 380px;
    /* The search input grows to fill the row, but never below
       ~140px so the placeholder copy stays readable when the
       facets row claims toolbar real estate. flex-basis seeds
       the input wider than the floor; min-width is the hard
       lower bound for the squeezed state. */
    flex: 1 1 220px;
    min-width: 140px;
  }

  /* Table view (.toolbar-stack) and YAML view (:host([yaml])) no
     longer carry a Filters control in the search row, so the search
     input seeds from a 0 flex-basis and fills the row the same way in
     both, matching the device-search width. Flex line-breaking uses
     the basis, not min-width, so the 220px basis above would push the
     view-toggle onto a second line at ~360px; a 0 basis keeps search +
     view-toggle on one row (search still grows to fill, floored by the
     140px min-width). The card toolbar keeps the 220px basis since its
     Filters control still shares this row. */
  .toolbar-stack .search-wrap,
  :host([yaml]) .search-wrap {
    flex-basis: 0;
  }
  /* Native <input class="search-input"> picks up the shared
     border / radius / focus-ring shape from inputStyles
     (src/styles/inputs.ts) — matches the .combobox-input shape
     used in the device editor. We only add padding-left to make
     room for the absolutely-positioned leading icon below.

     Selector specificity (0,2,0) — has to beat the
     input[type="search"] { padding: 0 14px } rule from
     inputStyles (0,1,1), otherwise the shorthand resets
     padding-left back to 14px and the icon ends up overlapping
     the placeholder. */
  .search-wrap .search-input {
    padding-left: 36px;
    /* Room for the clear (×); mirrors the 36px leading-icon inset. */
    padding-right: 36px;
    /* Share the toolbar control height so the search box matches the
       view-toggle / facet pills beside it (the input's default is the
       taller --wa-form-control-height). */
    min-height: var(--esphome-control-height);
  }

  /* Hide the native type="search" × so it doesn't double our own. */
  .search-wrap .search-input::-webkit-search-cancel-button {
    display: none;
  }

  /* Our clear control — shown only when a query is present. */
  .search-clear {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 18px;
    color: var(--wa-color-text-quiet);
    z-index: 1;
  }

  .search-clear:hover {
    color: var(--wa-color-text-normal);
  }

  /* Decorative leading icon — magnifier in device mode, code-braces
     in YAML mode. Not clickable: the YAML toggle lives next to the
     view-toggle buttons. */
  .search-input-icon {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 18px;
    color: var(--wa-color-text-quiet);
    pointer-events: none;
    z-index: 1;
  }

  /* Empty-device-search YAML pivot (option (d)) — sits between
     the "no devices found" copy and the Clear-search button.
     Filled brand-tinted button so it reads as the primary
     forward action rather than a secondary muted hint. */
  .empty-search-yaml-pivot {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    margin-top: 4px;
    background: var(--wa-color-brand-fill-quiet);
    color: var(--wa-color-brand-on-quiet);
    border: 1px solid var(--wa-color-brand-on-quiet);
    border-radius: 6px;
    cursor: pointer;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-action, 500);
    transition:
      background-color 0.15s ease,
      transform 0.05s ease;
  }
  .empty-search-yaml-pivot:hover {
    background: var(--wa-color-brand-fill-loud);
    color: var(--wa-color-brand-on-loud);
  }
  .empty-search-yaml-pivot:active {
    transform: translateY(1px);
  }

  /* Wrapper around the YAML pivot when slotted into the table's
     no-results-extra slot — gives a small top margin so the
     pivot sits under the "No results found." text without
     looking glued to it. */
  .yaml-preview-banner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--wa-space-s);
    margin-top: var(--wa-space-s);
  }

  /* ─── Device count row ─── */
  .device-count {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }
  .device-count strong {
    color: var(--wa-color-text-normal);
    font-weight: var(--wa-font-weight-bold);
  }

  /* Pairs the count with the Select-multiple toggle on a row of
     their own — both reference the device list, so they belong
     side-by-side. Grouped at the start so the toggle anchors to the
     count (and the search box above) in both card and table views
     rather than floating against the far edge. */
  .device-count-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--wa-space-s);
  }

  /* Table view slots the device-count-row through esphome-device-
     table's below-controls slot so the row spans the full table
     width. Horizontal padding matches .controls and .table-wrap
     above/below so the count and toggle line up with the leftmost
     column header and the search box above. Top padding draws from
     --toolbar-row-gap, mirroring card view's .toolbar gap so the
     inter-row spacing reads identically between views. Horizontal
     padding and top gap draw from the shared --content-gutter /
     --toolbar-row-gap tokens, so the count row trims on mobile and
     lines up with the toolbar above it without a separate @media rule. */
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
`;
