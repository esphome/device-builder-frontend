import { css } from "lit";

import { MOBILE_BREAKPOINT } from "../../styles/breakpoints.js";

export const dashboardStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    position: relative;
    box-sizing: border-box;
    height: calc(100vh - var(--esphome-header-height) - var(--esphome-footer-height));
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
       when toggling between views. */
    --toolbar-row-gap: 2px;
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

  /* ─── Discovered Banner ─── */

  /* ─── Discovered section ─── */

  @keyframes banner-slide-in {
    from {
      transform: translateY(-100%);
    }
    to {
      transform: translateY(0);
    }
  }

  /* Floating wrapper anchored to the top center of the dashboard.
     Absolutely positioned so opening the panel does NOT push the
     toolbar / cards below it — matches the original banner's
     "hanging from the top" behaviour. */
  .discovered-section {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
  }

  /* Inner elements re-enable pointer events so they're still
     clickable; only the empty space inside the wrapper is
     pass-through. */
  .discovered-section-header,
  .discovered-section-grid {
    pointer-events: auto;
    width: min(570px, 92%);
    box-sizing: border-box;
  }

  /* Header pill (the "first banner"). Classic / collapsed state:
     left + right + bottom borders outline the pill on its own; the
     top edge stays unbordered because the pill "hangs" from the
     page header. */
  .discovered-section-header {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-xs) var(--wa-space-m);
    background: var(--esphome-primary-light);
    color: var(--esphome-primary);
    border: var(--wa-border-width-s) solid var(--esphome-primary);
    border-top: none;
    border-radius: 0 0 var(--wa-border-radius-l) var(--wa-border-radius-l);
    font-size: var(--wa-font-size-s);
    animation: banner-slide-in 1s cubic-bezier(0.4, 0, 0.2, 1) both;
  }

  /* When the grid is visible, the pill keeps only its left + right
     borders and drops its bottom rounding — its sides flow into the
     panel below, whose own borders complete the outline. */
  .discovered-section:has(.discovered-section-grid:not([hidden]))
    .discovered-section-header {
    border-bottom: none;
    border-radius: 0;
  }

  .discovered-section-header wa-icon {
    font-size: var(--wa-font-size-m);
    color: var(--esphome-primary);
  }

  .discovered-section-count {
    font-weight: var(--wa-font-weight-bold);
    font-size: var(--wa-font-size-s);
  }

  .discovered-section-toggle {
    background: transparent;
    border: none;
    padding: 0;
    color: var(--esphome-primary);
    cursor: pointer;
    text-decoration: underline;
    font-weight: var(--wa-font-weight-bold);
    font-size: var(--wa-font-size-xs);
    font-family: inherit;
    opacity: 0.85;
  }
  /* First toggle on the row (Show / Hide for visible devices) is
     pushed against the right edge; any subsequent toggles (Show
     ignored) sit immediately after it with a small gap. */
  .discovered-section-toggle:first-of-type {
    margin-left: auto;
  }
  .discovered-section-toggle + .discovered-section-toggle {
    margin-left: var(--wa-space-s);
  }
  .discovered-section-toggle:hover {
    opacity: 1;
  }
  .discovered-section-toggle:focus-visible {
    outline: 2px solid var(--esphome-primary);
    outline-offset: 2px;
    opacity: 1;
  }

  /* Second banner: directly under the header (no gap), white
     background, primary border so the discovered-element panel is
     clearly outlined against the page. Rounded bottom corners.
     Caps height + scrolls internally so a long discoveries list
     stays inside the floating panel instead of stretching off-screen. */
  .discovered-section-grid {
    display: flex;
    flex-direction: column;
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--esphome-primary);
    border-top: none;
    border-radius: 0 0 var(--wa-border-radius-l) var(--wa-border-radius-l);
    max-height: min(50vh, 400px);
    overflow-y: auto;
  }

  .discovered-section-grid[hidden] {
    display: none;
  }

  /* Mobile: shrink the floating pill so it stops eating ~70px of
     viewport above the first device card. Same horizontal shape
     (icon + count + Show), just denser padding and smaller text /
     icon. The expandable grid below keeps its existing sizing —
     this only compacts the collapsed-state header. #41 */
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    .discovered-section-header {
      padding: var(--wa-space-2xs) var(--wa-space-s);
      gap: var(--wa-space-xs);
    }

    .discovered-section-header wa-icon {
      font-size: var(--wa-font-size-s);
    }

    .discovered-section-count {
      font-size: var(--wa-font-size-xs);
    }
  }

  /* ─── Card Grid ─── */

  .devices-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: var(--content-gutter);
    padding: var(--wa-space-l) var(--content-gutter);
  }

  /* When the grid follows the toolbar's count row (whether directly
     or with the empty-search pivot wedged between), the count row
     already provides spacing above the first card. Tighten the
     grid's top padding so the two rows don't double up. */
  .toolbar + .devices-grid,
  .toolbar + .empty-search + .devices-grid {
    padding-top: var(--wa-space-xs);
  }

  /* Only the configured-device grid needs FAB clearance: it's the
     last block on the page in card view, and the FAB sits directly
     on top of its trailing card's actions on a single-column mobile
     viewport. The discovered grid and skeleton both render above
     other content, so the normal bottom padding is fine. Driven by
     the same --fab-* tokens as the .fab-container rule below so the
     two can't drift. */
  .devices-grid--configured {
    padding-bottom: var(--fab-clearance);
  }

  /* display:grid wins over the user-agent hidden rule, so an
     explicitly hidden grid would still take its padding-worth of
     vertical space. Force display:none to honour the hidden
     attribute. */
  .devices-grid[hidden] {
    display: none;
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

  /* Facet pills cluster inline with the view-toggle. flex-wrap
     lets pills flow onto a second row of their own if too many
     accumulate (large fleets with several areas / platforms). */
  .filter-group {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--wa-space-2xs);
    row-gap: var(--wa-space-2xs);
    flex-shrink: 1;
    min-width: 0;
  }

  /* Trailing "Clear filters" action on the desktop facet row. Shares the
     toolbar control height so the strip stays aligned, but stays quiet
     (borderless, muted) so it doesn't read as another facet pill. */
  .filter-clear {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: var(--esphome-control-height);
    padding: 0 10px;
    border: none;
    border-radius: var(--wa-border-radius-m);
    background: transparent;
    color: var(--wa-color-text-quiet);
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold, 600);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background-color 0.12s,
      color 0.12s;
  }

  .filter-clear wa-icon {
    font-size: 16px;
  }

  .filter-clear:hover {
    color: var(--esphome-primary);
    background: var(--esphome-tint);
  }

  .filter-clear:focus-visible {
    outline: none;
    box-shadow: var(--esphome-focus-ring-tight);
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
    /* Share the toolbar control height so the search box matches the
       view-toggle / facet pills beside it (the input's default is the
       taller --wa-form-control-height). */
    min-height: var(--esphome-control-height);
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

  /* ─── YAML mode hit list ─── */

  .yaml-hits {
    display: flex;
    flex-direction: column;
    padding: var(--wa-space-m) var(--content-gutter) var(--wa-space-l);
    gap: var(--wa-space-l);
  }
  /* Title-only list (no search query): pack rows tightly so the
     navigable file list reads as a dense browser. Search-results
     mode keeps a larger inter-card gap so each device's snippet
     stack reads as its own section. */
  .yaml-hits:not(:has(.yaml-snippet)) {
    gap: var(--wa-space-2xs);
  }
  /* Each device's hits live inside one unified card — the header
     sits at the top and any snippet blocks stack below it within
     the same border. Switching between title-only and search-result
     mode swaps the *contents* of the card, not the card itself. */
  .yaml-hit-group {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-raised);
    overflow: hidden;
  }
  /* Card-level hover only makes sense in title-only mode where the
     entire card is one click target. In search-results mode the
     card hosts multiple independently-clickable snippet rows, so
     per-row hover (below) is what tracks the cursor. */
  .yaml-hits:not(:has(.yaml-snippet)) .yaml-hit-group {
    transition:
      background-color 0.12s,
      border-color 0.12s;
  }
  .yaml-hits:not(:has(.yaml-snippet)) .yaml-hit-group:hover {
    border-color: var(--esphome-tint-border-strong);
    background: var(--wa-color-surface-lowered);
  }
  .yaml-hit-group-header {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-s) var(--wa-space-m);
  }
  /* Divider between the device header and the snippet stack inside
     the same card. */
  .yaml-hit-group:has(.yaml-snippet) .yaml-hit-group-header {
    border-bottom: 1px solid var(--wa-color-surface-border);
  }
  .yaml-hit-group-header wa-icon {
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-l);
  }
  .yaml-hit-group-name {
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
    text-decoration: none;
    cursor: pointer;
    transition: color 0.12s;
  }
  .yaml-hit-group-name:hover,
  .yaml-hit-group-name:focus-visible {
    color: var(--esphome-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
    outline: none;
  }
  .yaml-hit-group-count {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    margin-left: auto;
  }
  /* Snippet rows sit inside the parent .yaml-hit-group card —
     no individual border / radius (the card already has them),
     just dividers between rows and a per-row hover highlight. */
  .yaml-snippet {
    display: block;
    color: var(--wa-color-text-normal);
    text-decoration: none;
    font-family: var(--wa-font-family-code, ui-monospace, monospace);
    font-size: var(--wa-font-size-s);
    padding: var(--wa-space-2xs) 0;
    transition: background-color 0.12s;
  }
  .yaml-snippet + .yaml-snippet {
    border-top: 1px solid var(--wa-color-surface-border);
  }
  .yaml-snippet:hover,
  .yaml-snippet:focus-visible {
    background: var(--wa-color-surface-lowered);
    outline: none;
  }
  .yaml-snippet-line {
    display: flex;
    align-items: baseline;
    padding: 1px 0;
  }
  .yaml-snippet-line--match {
    background: var(--esphome-tint);
  }
  .yaml-snippet-gutter {
    flex: 0 0 auto;
    width: 3em;
    padding: 0 var(--wa-space-s);
    text-align: right;
    color: var(--wa-color-text-quiet);
    user-select: none;
  }
  .yaml-snippet-text {
    flex: 1;
    /* Preserve YAML indentation but wrap long lines (lambdas /
       deeply-nested config) instead of horizontally scrolling. */
    white-space: pre-wrap;
    word-break: break-word;
    padding-right: var(--wa-space-s);
  }
  .yaml-snippet-text mark {
    background: color-mix(in srgb, var(--esphome-primary), transparent 70%);
    color: inherit;
    padding: 0 1px;
    border-radius: 2px;
  }
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
