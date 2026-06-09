import { css } from "lit";

/**
 * Styles for <esphome-device-navigator>. Extracted from the
 * component file to keep it under the repo's file-size cap (see
 * README → "Code structure policies"). The component pulls these
 * in via its ``static styles`` array alongside ``espHomeStyles``.
 */
export const deviceNavigatorStyles = css`
  :host {
    display: contents;
  }

  .card {
    background: var(--wa-color-surface-default);
    border-radius: var(--navigator-border-radius, var(--wa-border-radius-l));
    border: var(
      --navigator-border,
      var(--wa-border-width-s) solid var(--wa-color-surface-border)
    );
    box-shadow: var(--wa-elevation-02);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-s);
    padding: var(--wa-space-s) var(--wa-space-m);
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    flex-shrink: 0;
  }

  .card-title {
    margin: 0;
    line-height: 1;
    min-width: 0;
  }

  .card-title-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-2xs);
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: var(--wa-space-2xs) var(--wa-space-xs);
    margin-left: calc(-1 * var(--wa-space-xs));
    border-radius: var(--wa-border-radius-s);
    min-width: 0;
    line-height: 1;
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
  }

  .card-title-btn:hover {
    background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
  }

  .card-title-btn wa-icon {
    display: block;
    font-size: 18px;
    flex-shrink: 0;
  }

  .collapse-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--esphome-on-primary);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--wa-border-radius-s);
  }

  .collapse-btn:hover {
    background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
  }

  .collapse-btn wa-icon {
    font-size: 18px;
  }

  .card-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .italic {
    font-style: italic;
    font-size: var(--wa-font-size-2xs);
    padding: 0 var(--wa-space-m);
    margin: var(--wa-space-xs) 0;
    flex-shrink: 0;
  }

  .separator {
    height: 1px;
    background: var(--wa-color-surface-border);
    margin: var(--wa-space-2xs) 0;
    flex-shrink: 0;
  }

  .nav-empty {
    padding: var(--wa-space-l) var(--wa-space-m);
    margin: 0;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    text-align: center;
  }

  .nav-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--wa-space-m);
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
  }

  .nav-content-label {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    min-width: 0;
  }

  .nav-content:hover p {
    color: var(--esphome-primary);
  }

  .nav-content p {
    margin: var(--wa-space-xs) 0;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
  }

  .nav-content-label wa-icon {
    font-size: var(--wa-font-size-l);
    color: var(--esphome-primary);
    flex-shrink: 0;
  }

  .nav-content-chevron {
    font-size: var(--wa-font-size-xl);
    color: var(--esphome-primary);
    flex-shrink: 0;
  }

  .nav-subgroup-header {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    padding: var(--wa-space-2xs) var(--wa-space-m);
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
  }

  .nav-subgroup-header:not(.nav-subgroup-header--static):hover .nav-subgroup-title {
    color: var(--esphome-primary);
  }

  .nav-subgroup-header:focus-visible {
    outline: none;
    box-shadow: var(--esphome-focus-ring-tight);
    border-radius: var(--wa-border-radius-s);
  }

  /* While filtering the subgroup can't collapse, so it isn't interactive. */
  .nav-subgroup-header--static {
    cursor: default;
  }

  /* Muted leading domain glyph — on a domain subgroup header and on an
     ungrouped row (Core / Automations). Always visible. */
  .nav-subgroup-icon,
  .nav-item-icon {
    font-size: var(--wa-font-size-m);
    color: var(--wa-color-text-quiet);
    flex-shrink: 0;
  }

  .nav-subgroup-title {
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--wa-color-text-quiet);
  }

  .nav-subgroup-count {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    background: var(--wa-color-surface-raised);
    border-radius: 999px;
    padding: 0 var(--wa-space-xs);
    line-height: 1.5;
  }

  .nav-subgroup-chevron {
    margin-left: auto;
    font-size: var(--wa-font-size-l);
    color: var(--wa-color-text-quiet);
    flex-shrink: 0;
  }

  .nav-items {
    display: flex;
    flex-direction: column;
    gap: 1px;
    /* Trim the left inset so rows hug the panel edge; the icon/text reclaim
       the wasted gutter without crowding the right scrollbar. */
    padding: var(--wa-space-2xs) var(--wa-space-s) var(--wa-space-2xs) var(--wa-space-2xs);
  }

  /* Rows nested under a domain subgroup get a slight extra indent. */
  .nav-items--grouped {
    padding-top: 0;
    padding-left: var(--wa-space-m);
  }

  /* A single-of-a-kind domain collapses to one flat row in place of its
     subgroup header; align its glyph with the other subgroup-header glyphs by
     backing out the nav-item's own left padding and its transparent selection
     border (the header inset is the larger wa-space-m). */
  .nav-items--single {
    padding-top: 0;
    padding-bottom: 0;
    padding-left: calc(var(--wa-space-xs) - var(--wa-border-width-l));
  }

  .nav-item {
    padding: 0 var(--wa-space-xs);
    border-radius: var(--wa-border-radius-m);
    border-left: var(--wa-border-width-l) solid transparent;
    display: flex;
    align-items: center;
    gap: var(--wa-space-2xs);
    cursor: pointer;
    user-select: none;
    transition:
      background 0.1s,
      border-color 0.1s;
  }

  .nav-item:hover,
  .nav-item--hovered {
    background: var(--esphome-tint);
  }

  .nav-item--selected {
    background: var(--esphome-tint);
    border-left-color: var(--esphome-primary);
  }

  .nav-item-content {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    padding: var(--wa-space-2xs) 0;
  }

  .nav-item-content p {
    margin: 0;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nav-item-subtitle {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    font-weight: normal;
    margin: 0;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nav-item-chevron {
    margin-left: auto;
    font-size: var(--wa-font-size-l);
    color: var(--esphome-primary);
    flex-shrink: 0;
  }

  /* Declutter the chevron only where hover exists; on touch (no hover)
     it stays visible so the "this row navigates" cue isn't lost. */
  @media (hover: hover) {
    .nav-item-chevron {
      opacity: 0;
      transition: opacity 0.1s;
    }

    .nav-item:hover .nav-item-chevron,
    .nav-item--hovered .nav-item-chevron,
    .nav-item--selected .nav-item-chevron {
      opacity: 1;
    }
  }

  .action-item {
    padding: 0 var(--wa-space-2xs);
    border-radius: var(--wa-border-radius-m);
    display: flex;
    align-items: center;
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    justify-content: space-between;
    cursor: pointer;
    user-select: none;
    transition:
      background 0.1s,
      border-color 0.1s;
  }

  .action-item:hover,
  .action-item--hovered {
    opacity: 0.9;
  }

  .action-item p {
    margin: var(--wa-space-xs) 0;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
  }

  .action-item wa-icon {
    font-size: var(--wa-font-size-l);
  }

  .action-item div {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wa-space-2xs);
  }
`;
