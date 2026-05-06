import { css } from "lit";

export const dashboardStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: calc(100vh - var(--esphome-header-height));
    overflow: hidden;
    /* Single source of truth for the floating Create-device button's
       footprint. --fab-bottom is the gap between the FAB and the
       viewport edge (also the FAB's CSS bottom); --fab-height
       approximates the rendered button height (12+12px padding plus
       text). The card grid pads its bottom by their sum so the
       trailing card's action row never sits under the FAB. Defining
       these once stops the grid clearance and the FAB position from
       drifting if either gets tweaked later. */
    --fab-bottom: var(--wa-space-l);
    --fab-height: 48px;
    --fab-clearance: calc(var(--fab-bottom) + var(--fab-height) + var(--wa-space-xs));
  }

  :host([view="cards"]) {
    height: auto;
    overflow: visible;
  }

  /* ─── Discovered Banner ─── */

  @keyframes banner-slide-in {
    from {
      transform: translateY(-100%);
    }
    to {
      transform: translateY(0);
    }
  }

  .discovered-banner-wrap {
    display: flex;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
  }

  .discovered-banner {
    display: inline-flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--wa-space-xs);
    padding: var(--wa-space-xs) var(--wa-space-l) var(--wa-space-s);
    background: var(--esphome-secondary);
    border-radius: 0 0 var(--wa-border-radius-l) var(--wa-border-radius-l);
    font-size: var(--wa-font-size-s);
    color: var(--esphome-on-primary);
    animation: banner-slide-in 1s cubic-bezier(0.4, 0, 0.2, 1) both;
  }

  .discovered-banner wa-icon {
    font-size: var(--wa-font-size-m);
    color: var(--esphome-on-primary);
    margin-right: 10px;
  }
  /* Rendered as a real <button> (not an <a> without href) so the
     toggle is keyboard-focusable and announced as a button by
     assistive tech. The styling resets the native button chrome to
     keep the link-like look the design has always had. */
  .discovered-banner-toggle {
    background: transparent;
    border: none;
    padding: 0;
    color: var(--esphome-primary-light);
    cursor: pointer;
    text-decoration: underline;
    font-weight: var(--wa-font-weight-bold);
    font-size: var(--wa-font-size-2xs);
    font-family: inherit;
    margin-left: var(--wa-space-4xl);
    opacity: 0.85;
  }
  .discovered-banner-toggle:hover {
    opacity: 1;
  }
  .discovered-banner-toggle:focus-visible {
    outline: 2px solid var(--esphome-primary-light);
    outline-offset: 2px;
    opacity: 1;
  }
  .discovered-banner span {
    font-weight: var(--wa-font-weight-bold);
    font-size: var(--wa-font-size-xs);
  }
  .discovered-banner-empty {
    margin-right: var(--wa-space-4xl);
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
     attribute — used for #discovered-grid when the banner is
     collapsed or every discovery is filtered out. */
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
    max-width: 380px;
    flex: 1;
  }
  .search-input {
    width: 100%;
    /* wa-input owns its own border / radius / focus ring; we only
       set the font size so it tracks the rest of the toolbar. */
    --font-size-medium: var(--wa-font-size-s);
  }

  /* The leading wa-icon doubles as the YAML-mode toggle —
     role=button + tabindex makes it accessible without wrapping
     it in an HTML button element, which would break wa-input's
     internal slot=start sizing/centering. Just add a cursor +
     hover affordance + colour shift when pressed. */
  .search-mode-toggle {
    cursor: pointer;
    border-radius: 4px;
    transition:
      color 0.15s ease,
      background-color 0.15s ease;
  }
  .search-mode-toggle:hover {
    color: var(--wa-color-brand-on-quiet);
  }
  .search-mode-toggle:focus-visible {
    outline: 2px solid var(--wa-color-brand-on-quiet);
    outline-offset: 1px;
  }
  .search-mode-toggle[aria-pressed="true"] {
    color: var(--wa-color-brand-on-quiet);
  }

  /* Wrapper for the YAML-mode "Back to device search" link.
     Single-line, quiet treatment so the affordance reads as a
     subtle pointer back to the device-name search rather than a
     primary action. The toolbar's flex gap handles vertical
     spacing; no extra margin needed. */
  .search-discover-hint {
    display: block;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-xs);
  }
  /* Back-to-device-search link in YAML mode. A regular text
     link — not a kbd cap — because the action is "navigate
     back", not "press this key". Plain inline so it flows on
     the same baseline as any leading icon. */
  .search-discover-back {
    display: inline;
    padding: 0;
    background: transparent;
    border: none;
    color: var(--wa-color-text-quiet);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: var(--wa-color-text-quieter, transparent);
    text-underline-offset: 2px;
    transition:
      color 0.15s ease,
      text-decoration-color 0.15s ease;
  }
  .search-discover-back:hover,
  .search-discover-back:focus-visible {
    color: var(--wa-color-brand-on-quiet);
    text-decoration-color: currentColor;
    outline: none;
  }
  .search-discover-back wa-icon {
    font-size: var(--wa-font-size-s);
    vertical-align: middle;
    margin-right: 2px;
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
    padding: var(--wa-space-m) var(--wa-space-l) var(--wa-space-l);
    gap: 2px;
  }
  .yaml-hit {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-xs) var(--wa-space-s);
    border-radius: 6px;
    color: var(--wa-color-text-normal);
    text-decoration: none;
    font-size: var(--wa-font-size-s);
    transition: background-color 0.1s ease;
  }
  .yaml-hit:hover,
  .yaml-hit:focus-visible {
    background: var(--wa-color-surface-raised);
    outline: none;
  }
  .yaml-hit-label {
    /* Single line, ellipsis on overflow — long YAML lines
       (lambdas, comments) can run wide. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    font-family: var(--wa-font-family-code, ui-monospace, monospace);
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
