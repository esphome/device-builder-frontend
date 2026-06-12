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

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
  }

  .menu {
    position: fixed;
    z-index: 101;
    min-width: 220px;
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-l);
    box-shadow: var(--wa-shadow-l);
    padding: var(--wa-space-xs) 0;
    animation: menu-in 0.12s ease-out;
  }

  @keyframes menu-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: 8px var(--wa-space-m);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-normal);
    cursor: pointer;
    transition: background 0.1s;
    user-select: none;
  }

  .menu-item:hover {
    background: var(--esphome-tint);
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
