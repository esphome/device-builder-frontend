import { css } from "lit";

export const headerActionsStyles = css`
  :host {
    display: inline-flex;
    align-items: center;
    gap: 0;
  }

  .menu-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    border: none;
    background: none;
    color: var(--esphome-on-primary);
    cursor: pointer;
    padding: 6px;
    border-radius: var(--wa-border-radius-m);
    opacity: 0.85;
    transition:
      opacity 0.12s,
      background 0.12s;
  }

  .menu-btn:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
  }

  .menu-btn:focus-visible {
    outline: 2px solid var(--esphome-on-primary);
    outline-offset: 2px;
    opacity: 1;
  }

  .menu-btn wa-icon {
    font-size: 20px;
  }

  .menu-btn-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--esphome-warning, #f59e0b);
    box-shadow: 0 0 0 2px var(--esphome-primary);
  }

  /* .backdrop / .menu chrome / @keyframes menu-in / .menu-item come
     from the shared dropdownMenuStyles fragment; only the width is
     local to this menu. */
  .menu {
    min-width: 220px;
  }

  .menu-item wa-icon {
    font-size: 16px;
    color: var(--wa-color-text-quiet);
  }

  .menu-item:hover wa-icon {
    color: var(--esphome-primary);
  }

  .menu-item--active wa-icon {
    color: var(--esphome-primary);
  }

  .menu-item-label {
    flex: 1;
  }

  .menu-item .check {
    font-size: 14px;
    color: var(--esphome-primary);
  }

  .menu-item-count {
    margin-left: auto;
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--esphome-on-primary);
    background: var(--esphome-primary);
    border-radius: 999px;
    padding: 1px 8px;
    min-width: 18px;
    text-align: center;
  }

  .menu-item-shortcut {
    margin-left: auto;
    font-family: var(--wa-font-family-code, monospace);
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    background: var(--esphome-tint);
    border-radius: 4px;
    padding: 1px 6px;
  }

  /* Touch-primary viewports have no hardware keyboard to teach. */
  @media (hover: none) {
    .menu-item-shortcut {
      display: none;
    }
  }

  .menu-divider {
    height: 1px;
    background: var(--wa-color-surface-border);
    margin: var(--wa-space-2xs) 0;
  }

  .menu-label {
    padding: var(--wa-space-2xs) var(--wa-space-m);
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
`;
