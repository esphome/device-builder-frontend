import { css } from "lit";

/** Dashboard YAML search mode hit list. */
export const yamlModeStyles = css`
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
`;
