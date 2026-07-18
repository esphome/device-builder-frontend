import { css } from "lit";

import { MOBILE_BREAKPOINT } from "../../styles/breakpoints.js";

/**
 * Styles for <esphome-wizard-step-board>. Extracted from the
 * component file to keep it under the repo's file-size cap (see
 * README → "Code structure policies"). The step pulls these in
 * via its ``static styles`` array alongside ``espHomeStyles`` and
 * ``inputStyles``. Class names cover the detection-mode helper
 * rows, the platform-filter chips, the board grid / cards, and the
 * connect-board and starter-kit affordances.
 */
export const wizardStepBoardStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
  }

  .helper-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wa-space-s);
    font-size: var(--wa-font-size-xs);
    margin-top: calc(-1 * var(--wa-space-2xs));
  }

  .helper-link {
    border: none;
    padding: 0;
    background: none;
    color: var(--esphome-primary);
    cursor: pointer;
    text-decoration: underline;
    font: inherit;
  }

  .helper-link:hover {
    text-decoration: none;
  }

  .detect-error {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-danger-text-normal);
    margin-top: calc(-1 * var(--wa-space-2xs));
  }

  .connect-board-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-xs);
    padding: var(--wa-space-xs) var(--wa-space-m);
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--esphome-primary);
    background: var(--esphome-primary-light);
    border: none;
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    transition: background 0.12s;
  }

  .connect-board-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--esphome-primary-light), black 5%);
  }

  .connect-board-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .connect-board-btn wa-icon {
    font-size: 16px;
  }

  .featured-card {
    display: flex;
    gap: var(--wa-space-l);
    padding: var(--wa-space-m);
    border-radius: var(--wa-border-radius-l);
    border: var(--wa-border-width-m) solid var(--wa-color-surface-border);
  }

  .featured-image {
    width: 120px;
    height: 80px;
    object-fit: contain;
    flex-shrink: 0;
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-default);
    padding: var(--wa-space-xs);
    box-sizing: border-box;
  }

  .featured-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
    min-width: 0;
  }

  .featured-title {
    margin: 0;
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .featured-desc {
    margin: 0;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
  }

  .featured-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--wa-space-xs);
  }

  .section-label {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: var(--wa-space-s) 0;
    margin: 0;
  }

  .boards-scroll {
    height: 500px;
    overflow-y: auto;
    padding-right: var(--wa-space-2xs);
  }

  .boards-grid {
    display: grid;
    /* minmax(0, 1fr), not 1fr (= minmax(auto, 1fr)): a card with wide
       min-content (a long unbreakable token in a name/description) would
       otherwise blow its column past its fair share and shrink the other. */
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--wa-space-s);
  }

  .board-card {
    position: relative;
    border-radius: var(--wa-border-radius-l);
    background: var(--wa-color-surface-default);
    padding: var(--wa-space-m);
    box-sizing: border-box;
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
    transition: border-color var(--wa-transition-normal) var(--wa-transition-easing);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .board-card:hover {
    border-color: var(--esphome-primary);
  }

  .board-card--expanded {
    grid-column: 1 / -1;
  }

  .board-card-header {
    display: flex;
    align-items: flex-start;
    gap: var(--wa-space-s);
  }

  .board-image {
    width: 48px;
    height: 36px;
    object-fit: contain;
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-subtle);
    flex-shrink: 0;
    padding: 3px;
    box-sizing: border-box;
  }

  .board-card-header-text {
    flex: 1;
    min-width: 0;
  }

  .board-title {
    margin: 0;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .expand-button {
    border: none;
    background: none;
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    margin-top: -2px;
    color: var(--esphome-primary);
    font-size: 18px;
  }

  .expand-button wa-icon {
    transition: transform var(--wa-transition-normal) var(--wa-transition-easing);
  }

  .board-description {
    margin: 0;
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .board-description--clamp {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--wa-space-2xs);
  }

  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-s);
    margin-top: auto;
    padding-top: var(--wa-space-m);
  }

  .more-info {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--wa-font-size-xs);
    color: var(--esphome-primary);
    text-decoration: none;
  }

  .more-info:hover {
    text-decoration: underline;
  }

  .more-info wa-icon {
    font-size: 13px;
  }

  .select-board {
    display: flex;
    align-items: center;
    gap: 4px;
    border: none;
    background: none;
    padding: 0;
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--esphome-primary);
    cursor: pointer;
  }

  .select-board:focus-visible {
    outline: var(--esphome-focus-outline);
    outline-offset: 3px;
  }

  .platform-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .detection-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-s);
    padding: var(--wa-space-s) var(--wa-space-m);
    border-radius: var(--wa-border-radius-m);
    background: var(--esphome-tint);
    border: var(--wa-border-width-s) solid
      color-mix(in srgb, var(--esphome-primary), transparent 70%);
    color: var(--wa-color-text);
    font-size: var(--wa-font-size-s);
  }

  .platform-chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    cursor: pointer;
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: transparent;
    color: var(--wa-color-text-quiet);
    transition: all 0.12s;
  }

  .platform-chip:hover {
    border-color: var(--esphome-primary);
    color: var(--esphome-primary);
  }

  .platform-chip--active {
    background: var(--esphome-tint);
    border-color: var(--esphome-primary);
    color: var(--esphome-primary);
  }

  .loading {
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
    text-align: center;
    padding: var(--wa-space-xl);
  }

  /* Mobile overrides — placed at the end of the stylesheet so
     they win the same-specificity source-order fight against
     the base .featured-card / .featured-image /
     .board-card-header / .board-image rules above. Caught by
     Copilot review on PR #400 — the prior placement inline
     with the base rules left align-items / width / height
     silently overridden. #41 */
  /* The board list's inner scroller is a fixed 500px on desktop so the
     filter chips stay pinned while only the grid scrolls. The wizard goes
     full-screen at MOBILE_BREAKPOINT, and at that width the fixed height runs
     past the viewport — the featured card's bottom is clipped and unreachable
     (iPhone XR repro). Collapse the inner scroller at the same cutoff the
     sheet uses so the dialog body scrolls as one. */
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    .boards-scroll {
      height: auto;
      overflow-y: visible;
    }
  }

  @media (max-width: 480px) {
    .boards-grid {
      grid-template-columns: 1fr;
    }

    /* Featured (Apollo Starter Kit) card: image-left +
       text-right wraps to one word per line at phone width.
       Stack vertically so the description has the full card
       width. */
    .featured-card {
      flex-direction: column;
      gap: var(--wa-space-s);
    }

    .featured-image {
      width: 100%;
      height: 160px;
    }

    /* Regular board cards: header row was image-on-left +
       title-on-the-right; at narrow widths the right column
       shrinks to ~140px and titles wrap awkwardly. Stack
       image above title so each row gets the full card width. */
    .board-card-header {
      flex-direction: column;
      align-items: stretch;
    }

    .board-image {
      width: 100%;
      height: 100px;
    }
  }
`;
