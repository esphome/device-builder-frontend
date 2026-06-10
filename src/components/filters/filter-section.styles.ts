/**
 * Accordion-section chrome shared by ``<esphome-filter-section>``
 * and ``<esphome-labels-filter-section>``: the header button with
 * its count chip and chevron, and the collapsible body container.
 */
import { css } from "lit";

export const filterSectionStyles = css`
  :host {
    display: block;
  }

  :host(:not(:first-of-type)) {
    border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: var(--wa-border-radius-m);
    background: transparent;
    color: var(--wa-color-text-normal);
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold, 600);
    text-align: left;
    cursor: pointer;
    transition: background-color 0.1s;
  }

  .section-header:hover,
  .section-header:focus-visible {
    background: color-mix(in srgb, var(--wa-color-text-normal), transparent 94%);
    outline: none;
  }

  .section-name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Per-dimension active-selection count. Carries the signal the
     old per-pill trigger badges used to. */
  .section-count {
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
    flex-shrink: 0;
  }

  .section-chevron {
    flex-shrink: 0;
    color: var(--wa-color-text-quiet);
    font-size: 16px;
    display: inline-flex;
    transition: transform 0.15s;
  }

  :host([expanded]) .section-chevron {
    transform: rotate(180deg);
  }

  .section-body {
    display: flex;
    flex-direction: column;
    padding: 0 0 var(--wa-space-2xs);
  }

  /* Cap the option list so one populous section scrolls inside
     itself instead of pushing the other section headers out of the
     popover's viewport. */
  .section-body .facet-list {
    max-height: 280px;
  }
`;
