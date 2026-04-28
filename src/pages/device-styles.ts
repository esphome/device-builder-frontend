import { css } from "lit";

export const devicePageStyles = css`
  :host {
    display: block;
  }

  .page {
    box-sizing: border-box;
    padding: var(--wa-space-l);
    min-height: calc(100vh - var(--esphome-header-height));
  }

  .layout-grid {
    display: grid;
    grid-template-columns: minmax(230px, 1fr) minmax(0, 5fr);
    gap: var(--wa-space-l);
    height: calc(100vh - var(--esphome-header-height) - 2 * var(--wa-space-l));
    transition: grid-template-columns 0.25s ease;
  }

  .layout-grid.nav-collapsed {
    grid-template-columns: minmax(0, 5fr);
  }

  .layout-grid.nav-collapsed .desktop-nav {
    display: none;
  }

  .drawer,
  .drawer-backdrop {
    display: none;
  }

  .nav-toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: color-mix(in srgb, var(--esphome-on-primary), transparent 80%);
    color: var(--esphome-on-primary);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--wa-border-radius-m);
    margin-right: var(--wa-space-xs);
  }

  .nav-toggle-btn wa-icon {
    font-size: 14px;
  }

  .nav-toggle-btn:hover {
    background: color-mix(in srgb, var(--esphome-on-primary), transparent 70%);
  }

  @media (max-width: 900px) {
    .layout-grid {
      grid-template-columns: 1fr;
      height: calc(100vh - var(--esphome-header-height) - 2 * var(--wa-space-l));
    }

    .desktop-nav {
      display: none !important;
    }

    .drawer-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 99;
    }

    .drawer-backdrop--open {
      display: block;
    }

    .drawer {
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: 300px;
      max-width: 85vw;
      z-index: 100;
      background: var(--wa-color-surface-default);
      box-shadow: var(--wa-shadow-l);
      overflow-y: auto;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
      --navigator-border-radius: 0;
      --navigator-border: none;
    }

    .drawer--open {
      transform: translateX(0);
    }
  }
`;
