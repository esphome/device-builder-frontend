import { css } from "lit";

export const dashboardStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    position: relative;
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
  }

  :host([view="cards"]) {
    height: auto;
    overflow: visible;
    /* Body scrolls in cards view (incl. YAML mode), and the layout
       footer is fixed and opaque — without this padding the trailing
       row of yaml-hits / banner content can sit behind the version
       line. The configured device grid has its own --fab-clearance,
       so this only matters for the YAML / discovered content paths. */
    padding-bottom: var(--esphome-footer-height);
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
    padding: var(--wa-space-s) var(--wa-space-l);
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
    font-size: var(--wa-font-size-l);
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

  /* ─── Card Grid ─── */

  .devices-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: var(--wa-space-l);
    padding: var(--wa-space-l);
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
    gap: 2px;
    padding: var(--wa-space-l) var(--wa-space-l) 0;
    flex-shrink: 0;
  }
  .toolbar-row {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
  }

  /* Pushes the filter group to the right edge of the toolbar so
     view-toggles (left of the spacer) and filter affordances
     (right of the spacer) read as separate clusters. Collapses to
     zero on viewports too narrow to afford it — the row wraps via
     'flex-wrap' higher up if individual buttons overflow. */
  .toolbar-spacer {
    flex: 1 1 auto;
    min-width: var(--wa-space-s);
  }

  .filter-group {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-xs);
    flex-shrink: 0;
  }

  .search-wrap {
    position: relative;
    max-width: 380px;
    flex: 1;
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
    padding: var(--wa-space-m) 0 var(--wa-space-l);
    gap: var(--wa-space-l);
  }
  .yaml-hit-group {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
  }
  .yaml-hit-group-header {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding-bottom: var(--wa-space-xs);
    border-bottom: 1px solid var(--wa-color-surface-border);
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
  /* The legacy .yaml-hit / .yaml-hit-label rows (palette-style
     flat per-match listing) are gone from the dashboard; the
     snippet-block styles below replace them with a grouped
     code-search shape. */
  .yaml-snippet {
    display: block;
    background: var(--wa-color-surface-lowered);
    border: 1px solid var(--wa-color-surface-border);
    border-radius: 6px;
    color: var(--wa-color-text-normal);
    text-decoration: none;
    font-family: var(--wa-font-family-code, ui-monospace, monospace);
    font-size: var(--wa-font-size-s);
    overflow: hidden;
    transition:
      border-color 0.1s ease,
      background-color 0.1s ease;
  }
  .yaml-snippet:hover,
  .yaml-snippet:focus-visible {
    border-color: var(--esphome-primary);
    outline: none;
  }
  .yaml-snippet-line {
    display: flex;
    align-items: baseline;
    padding: 1px 0;
  }
  .yaml-snippet-line--match {
    background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
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
    padding-left: 2px;
  }
  .device-count strong {
    color: var(--wa-color-text-normal);
    font-weight: var(--wa-font-weight-bold);
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
    width: 36px;
    height: 36px;
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
    background: color-mix(in srgb, var(--esphome-primary), black 10%);
  }

  .view-toggle-btn wa-icon {
    font-size: 18px;
  }

  /* Standalone toggle for "select multiple devices" mode. Sits next to
   * the view-toggle and matches its size/feel, but is its own button so
   * users don't read it as part of the view-type group. */
  .select-toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--wa-border-radius-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-raised);
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s,
      border-color 0.12s;
    padding: 0;
    flex-shrink: 0;
  }

  .select-toggle-btn:hover {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
  }

  .select-toggle-btn.active {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    border-color: var(--esphome-primary);
  }

  .select-toggle-btn.active:hover {
    background: color-mix(in srgb, var(--esphome-primary), black 10%);
  }

  .select-toggle-btn wa-icon {
    font-size: 18px;
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
    background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
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
    background: color-mix(in srgb, var(--esphome-primary), transparent 96%);
    min-height: 200px;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s,
      transform 0.15s;
  }
  .add-device-card:hover {
    border-color: var(--esphome-primary);
    background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
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
  }

  .table-create-btn:hover {
    background: color-mix(in srgb, var(--esphome-primary), black 10%);
  }

  .table-create-btn wa-icon {
    font-size: 15px;
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
    background: color-mix(in srgb, var(--esphome-primary), black 10%);
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
