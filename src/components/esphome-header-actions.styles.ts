import { css } from "lit";

export const headerActionsStyles = css`
  :host {
    display: inline-flex;
    align-items: center;
    gap: 0;
    position: relative;
  }

  .menu-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    border: none;
    background: none;
    color: var(--wa-color-text-quiet);
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
    background: var(--esphome-tint);
    color: var(--esphome-primary);
  }

  .menu-btn:focus-visible {
    outline: 2px solid var(--esphome-primary);
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
    box-shadow: 0 0 0 2px var(--wa-color-surface-default);
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
  }

  .menu {
    position: absolute;
    top: 100%;
    right: 0;
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

  /* ─── Version info in menu footer ─── */
  .menu-version-info {
    padding: var(--wa-space-2xs) var(--wa-space-m);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .menu-version-badge {
    display: inline-block;
    align-self: flex-start;
    font-size: 9px;
    font-weight: var(--wa-font-weight-bold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: var(--wa-border-radius-s);
    background: var(--esphome-tint);
    color: var(--esphome-primary);
    border: 1px solid color-mix(in srgb, var(--esphome-primary), transparent 60%);
    line-height: 1;
    margin-bottom: 2px;
  }

  .menu-version-row {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    line-height: 1.4;
  }

  .menu-version-link {
    color: inherit;
    text-decoration: none;
    cursor: pointer;
  }

  .menu-version-link:hover {
    text-decoration: underline;
    color: var(--esphome-primary);
  }

  .menu-version-text {
    color: inherit;
  }
`;