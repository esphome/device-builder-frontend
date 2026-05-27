import { css } from "lit";

export const componentCatalogStyles = css`
  :host {
    display: flex;
    height: 480px;
    gap: 0;
  }

  :host([hidden]) {
    display: none;
  }

  .sidebar {
    width: 160px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    padding-right: var(--wa-space-m);
    border-right: 1px solid var(--wa-color-surface-border);
    overflow-y: auto;
  }

  .sidebar-label {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 var(--wa-space-2xs);
    flex-shrink: 0;
  }

  .category-btn {
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    padding: var(--wa-space-xs) var(--wa-space-s);
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
    transition: background 0.1s;
    font-family: inherit;
    flex-shrink: 0;
  }

  .category-btn:hover {
    background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
    color: var(--esphome-primary);
  }

  .category-btn--active {
    background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
    color: var(--esphome-primary);
  }

  .category-btn-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-xs);
  }

  .category-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: 9px;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    background: var(--wa-color-surface-raised);
    color: var(--wa-color-text-subtle);
    flex-shrink: 0;
    box-sizing: border-box;
  }

  .category-btn--active .category-count {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
    padding-left: var(--wa-space-m);
    padding-top: 3px;
    padding-right: 3px;
    overflow: hidden;
  }

  input[type="search"] {
    flex-shrink: 0;
  }

  .result-count {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    flex-shrink: 0;
    margin-top: -6px;
  }

  .grid-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: var(--wa-space-2xs);
  }

  /* auto-fill + minmax so the grid drops 2 → 1 column as soon as a card
     would shrink below ~340px — avoids hard viewport breakpoints. */
  .components-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 8px;
    align-content: start;
  }

  /* Below ~600px (modal viewport on phones) collapse sidebar into a
     horizontal chip row above the grid. */
  @media (max-width: 600px) {
    :host {
      flex-direction: column;
      height: auto;
      max-height: 70vh;
    }

    .sidebar {
      width: 100%;
      flex-direction: row;
      gap: var(--wa-space-2xs);
      padding-right: 0;
      padding-bottom: var(--wa-space-s);
      margin-bottom: var(--wa-space-s);
      overflow-x: auto;
      overflow-y: hidden;
      border-right: none;
      border-bottom: 1px solid var(--wa-color-surface-border);
    }

    .sidebar-label {
      display: none;
    }

    .category-btn {
      flex-shrink: 0;
      white-space: nowrap;
    }

    .main {
      padding-left: 0;
      padding-right: 0;
    }
  }

  .component-card {
    border-radius: var(--wa-border-radius-l);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-default);
    padding: var(--wa-space-s) var(--wa-space-m);
    box-sizing: border-box;
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 6px;
    cursor: pointer;
    transition:
      border-color var(--wa-transition-normal) var(--wa-transition-easing),
      background var(--wa-transition-normal) var(--wa-transition-easing);
  }

  .component-card:hover {
    border-color: var(--esphome-primary);
    background: color-mix(in srgb, var(--esphome-primary), transparent 96%);
  }

  .component-card:focus-within {
    border-color: var(--esphome-primary);
  }

  .component-card--expanded {
    grid-column: 1 / -1;
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
    color: var(--esphome-primary);
    font-size: 15px;
  }

  .expand-button:focus-visible {
    outline: 2px solid var(--esphome-primary);
    outline-offset: 1px;
  }

  .expand-button wa-icon {
    transition: transform var(--wa-transition-normal) var(--wa-transition-easing);
  }

  .component-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .component-image,
  .component-image--placeholder {
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-subtle);
    flex-shrink: 0;
    color: var(--esphome-primary);
    font-size: 28px;
    box-sizing: border-box;
  }

  .component-image {
    padding: 4px;
  }

  .component-image img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  /* ESPHome's monochrome SVG illustrations are black-on-transparent —
     invert + hue-rotate in dark mode (apply-theme.ts root var). Scoped
     to SVGs so JPGs/PNGs keep their original colours. */
  .component-image img[src$=".svg"] {
    filter: var(--esphome-svg-filter, none);
  }

  .component-card-header-text {
    flex: 1;
    min-width: 0;
  }

  .component-title {
    margin: 0;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Category chip disambiguates same-name catalog entries (sensor.debug
     vs text_sensor.debug). Only shown under "All" / "Featured" — see
     shouldShowCategoryChip. */
  .component-category-chip {
    display: inline-block;
    margin-top: 2px;
    padding: 0 6px;
    font-size: 9px;
    font-weight: var(--wa-font-weight-semibold);
    line-height: 1.6;
    color: var(--wa-color-text-quiet);
    background: var(--wa-color-surface-raised);
    border: 1px solid var(--wa-color-border);
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .component-description {
    margin: 0;
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    line-height: 1.4;
  }

  .component-description--clamp {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-xs);
    margin-top: auto;
  }

  .more-info {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: var(--wa-font-size-2xs);
    color: var(--esphome-primary);
    text-decoration: none;
  }

  .more-info:hover {
    text-decoration: underline;
  }

  .more-info wa-icon {
    font-size: 11px;
  }

  .select-component {
    display: flex;
    align-items: center;
    gap: 3px;
    border: none;
    background: none;
    padding: 0;
    border-radius: 4px;
    font-family: inherit;
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--esphome-primary);
    cursor: pointer;
  }

  .select-component:focus-visible {
    outline: 2px solid var(--esphome-primary);
    outline-offset: 3px;
  }

  .empty {
    text-align: center;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
    padding: var(--wa-space-xl);
    grid-column: 1 / -1;
  }

  .loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
  }

  /* Featured cards get a subtle primary border so they read as the
     curated set, distinct from the regular catalog. */
  .component-card--featured {
    border-color: color-mix(in srgb, var(--esphome-primary), transparent 70%);
  }

  .bundle-badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--esphome-primary);
    background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
    border-radius: var(--wa-border-radius-s);
    padding: 1px 6px;
  }

  .bundle-badge wa-icon {
    font-size: 11px;
  }
`;
