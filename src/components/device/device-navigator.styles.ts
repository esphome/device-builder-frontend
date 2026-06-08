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
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
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

  .nav-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--wa-space-m);
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
  }

  .nav-content:hover p {
    color: var(--esphome-primary);
  }

  .nav-content p {
    margin: var(--wa-space-xs) 0;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
  }

  .nav-content wa-icon {
    font-size: var(--wa-font-size-xl);
    color: var(--esphome-primary);
  }

  .nav-items {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    padding: var(--wa-space-xs) var(--wa-space-m);
  }

  .nav-item {
    padding: 0 var(--wa-space-2xs);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    display: flex;
    align-items: center;
    justify-content: space-between;
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
    border-color: var(--esphome-primary);
  }

  .nav-item--selected {
    background: var(--esphome-tint);
    border-color: var(--esphome-primary);
  }

  .nav-item-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: var(--wa-space-xs) 0;
  }

  .nav-item-content p {
    margin: 0;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
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

  .nav-item wa-icon {
    font-size: var(--wa-font-size-xl);
    color: var(--esphome-primary);
    flex-shrink: 0;
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
