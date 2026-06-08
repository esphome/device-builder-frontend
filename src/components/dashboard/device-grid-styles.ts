import { css } from "lit";

import { MOBILE_BREAKPOINT } from "../../styles/breakpoints.js";

/** Discovered + configured device grids and the create-device affordances (add card, table create button, FAB). */
export const deviceGridStyles = css`
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
