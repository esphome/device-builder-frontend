import { css } from "lit";

export const secretsStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: calc(100vh - var(--esphome-header-height) - var(--esphome-footer-height));
    box-sizing: border-box;
  }

  .page {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: var(--wa-space-l) var(--content-gutter);
    gap: var(--wa-space-m);
    overflow: hidden;
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: var(--wa-space-m);
    flex-shrink: 0;
  }

  .page-title {
    flex: 1;
  }

  .page-title h1 {
    margin: 0 0 2px;
    font-size: var(--wa-font-size-l);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .page-title p {
    margin: 0;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
  }

  .editor-card {
    flex: 1;
    position: relative;
    background: var(--wa-color-surface-default);
    border-radius: var(--wa-border-radius-l);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    box-shadow: var(--wa-elevation-02);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .save-button {
    position: absolute;
    bottom: var(--wa-space-m);
    right: var(--wa-space-m);
    z-index: 10;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    /* Match the shared .btn size so Save aligns with Add secret. */
    padding: var(--esphome-button-padding);
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    box-shadow: var(--esphome-primary-shadow);
    transition:
      background 0.12s,
      box-shadow 0.12s,
      transform 0.12s;
  }

  .save-button:hover:not(:disabled) {
    background: var(--esphome-primary-hover);
    box-shadow: var(--esphome-primary-shadow-hover);
    transform: translateY(-1px);
  }

  .save-button:active:not(:disabled) {
    transform: translateY(0);
  }

  .save-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    box-shadow: none;
  }

  .save-button wa-icon {
    font-size: 16px;
  }

  .reveal-toggle {
    border: var(--wa-border-width-s) solid var(--esphome-primary);
    background: var(--esphome-tint);
    color: var(--esphome-primary);
    padding: 6px 12px;
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: inherit;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    transition: background 0.12s;
  }

  .reveal-toggle:hover {
    background: var(--esphome-tint-strong);
  }

  .reveal-toggle wa-icon {
    font-size: 16px;
  }

  .layout-toggle {
    display: inline-flex;
    align-items: center;
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    overflow: hidden;
    flex-shrink: 0;
  }

  .layout-toggle button {
    border: none;
    background: transparent;
    color: var(--wa-color-text-quiet);
    padding: 6px 10px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .layout-toggle button + button {
    border-left: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .layout-toggle button[aria-pressed="true"] {
    background: var(--esphome-tint);
    color: var(--esphome-primary);
  }

  .layout-toggle wa-icon {
    font-size: 18px;
  }

  .editor-layout {
    flex: 1;
    min-height: 0;
    display: grid;
    gap: 0;
  }

  .editor-layout--form,
  .editor-layout--yaml {
    grid-template-columns: 1fr;
  }

  .editor-pane {
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .editor-pane > * {
    flex: 1;
    min-height: 0;
  }

  /* The editor scrolls itself and owns its padding, so its scrollbar
     sits at the card edge, not over the row controls. */
  .editor-pane--form {
    padding: 0;
  }

  .editor-layout--yaml .editor-pane--form,
  .editor-layout--form .editor-pane--yaml {
    display: none;
  }

  @media (max-width: 900px) {
    .page {
      padding-block: var(--wa-space-s);
    }
    .page-header {
      flex-wrap: wrap;
    }
    .page-title {
      flex-basis: 100%;
    }
  }

  .loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
    color: var(--wa-color-text-quiet);
  }
`;
