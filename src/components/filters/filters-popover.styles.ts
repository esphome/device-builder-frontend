/**
 * Styles for <esphome-filters-popover>: the trigger's count badge
 * and the popover frame hosting the accordion sections.
 */
import { css } from "lit";

export const filtersPopoverStyles = css`
  :host {
    display: inline-block;
    position: relative;
  }

  .filters-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-semibold, 600);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .filters-popover {
    position: absolute;
    z-index: 10;
    top: calc(100% + 6px);
    left: 0;
    width: min(340px, calc(100vw - 32px));
    max-height: min(440px, calc(100dvh - 160px));
    background: var(--wa-color-surface-default);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-l);
    box-shadow: var(--wa-shadow-m);
    padding: var(--wa-space-2xs);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .filters-popover.anchor-right {
    left: auto;
    right: 0;
  }

  .filters-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-s);
    padding: 6px 10px;
    flex-shrink: 0;
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .filters-title {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .filters-clear-link {
    background: transparent;
    border: none;
    padding: 2px 6px;
    border-radius: var(--wa-border-radius-s);
    color: var(--esphome-primary);
    font-family: inherit;
    font-size: var(--wa-font-size-xs);
    cursor: pointer;
    transition:
      color 0.12s,
      background-color 0.12s;
  }

  .filters-clear-link:hover,
  .filters-clear-link:focus-visible {
    background: var(--esphome-tint);
    outline: none;
  }

  /* One scroll region, not two: the closed headers keep their
     natural height and stay visible, and the single expanded
     section flexes into whatever room is left, scrolling its
     option list internally. The container itself only scrolls in
     the degenerate case where the expanded section's floor plus
     the headers outgrow a very short viewport (landscape phone). */
  .filters-sections {
    overflow-y: auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  ::slotted(esphome-filter-section),
  ::slotted(esphome-labels-filter-section) {
    flex: 0 0 auto;
  }

  ::slotted(esphome-filter-section[expanded]),
  ::slotted(esphome-labels-filter-section[expanded]) {
    flex: 1 1 auto;
    min-height: 0;
  }

  /* On very short viewports (landscape phone) the headers alone can
     eat the whole popover; floor the expanded section so its list
     keeps a usable height, letting the container scroll instead. */
  @media (max-height: 500px) {
    ::slotted(esphome-filter-section[expanded]),
    ::slotted(esphome-labels-filter-section[expanded]) {
      min-height: 176px;
    }
  }
`;
