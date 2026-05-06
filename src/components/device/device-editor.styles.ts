import { css } from "lit";

export const deviceEditorStyles = css`
  :host {
    display: contents;
  }

  /* Fullscreen mode covers the surrounding app shell (top bar,
     navigator, page padding). The card-header stays visible so the
     user keeps Save / layout / Collapse within reach — same shape as
     the logs dialog's expand mode. z-index sits above app chrome
     (which uses values up to ~50) but below modal dialogs (>=1000). */
  :host([fullscreen]) .card {
    position: fixed;
    inset: 0;
    z-index: 100;
    border: none;
    border-radius: 0;
    box-shadow: none;
  }

  .card {
    background: var(--wa-color-surface-default);
    border-radius: var(--wa-border-radius-l);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    box-shadow: var(--wa-elevation-02);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--wa-space-s) var(--wa-space-m);
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  /* Navigator hidden + YAML-only layout = the title bar is the only
     non-editor chrome left on screen. Squeeze it so it gives the
     YAML editor back the vertical space the user already implicitly
     asked for by collapsing both panels. */
  .card-header--compact {
    padding: var(--wa-space-2xs) var(--wa-space-m);
  }

  .card-header--compact .editor-header-title {
    font-size: var(--wa-font-size-2xs);
  }

  .card-header--compact .layout-toggle wa-icon,
  .card-header--compact .diff-toggle wa-icon {
    font-size: 16px;
  }

  .editor-header-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .editor-header-title {
    margin: 0;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .editor-floating-actions {
    position: absolute;
    bottom: var(--wa-space-m);
    right: var(--wa-space-m);
    z-index: 10;
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-s);
  }

  .save-button,
  .validate-button,
  .install-fab {
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    gap: 3px;
    padding: 7px 14px;
    border: var(--wa-border-width-s) solid transparent;
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    line-height: 1;
    transition:
      background 0.12s,
      border-color 0.12s,
      box-shadow 0.12s,
      transform 0.12s;
  }

  .save-button {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--esphome-primary), transparent 50%);
  }

  .save-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--esphome-primary), black 10%);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--esphome-primary), transparent 35%);
    transform: translateY(-1px);
  }

  .save-button:active:not(:disabled) {
    transform: translateY(0);
  }

  .save-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    box-shadow: none;
    transform: none;
  }

  /* Subordinate to Save: surface-tinted variant so the primary
     action stays visually dominant. The disabled state (YAML buffer
     dirty) is the more common one — a bright primary button there
     would compete with Save for attention. */
  .validate-button {
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-normal);
    border-color: var(--wa-color-surface-border);
  }

  .validate-button:hover:not(:disabled) {
    background: var(--wa-color-surface-raised);
    border-color: color-mix(in srgb, var(--wa-color-text-normal), transparent 70%);
  }

  .validate-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .install-fab {
    background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
    color: var(--esphome-primary);
    border-color: color-mix(in srgb, var(--esphome-primary), transparent 70%);
  }

  .install-fab:hover:not(:disabled) {
    background: color-mix(in srgb, var(--esphome-primary), transparent 82%);
    border-color: var(--esphome-primary);
  }

  .install-fab:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .save-button wa-icon,
  .validate-button wa-icon,
  .install-fab wa-icon {
    font-size: 16px;
  }

  /* Tooltip carrier so the "why disabled" hint reaches mouse users
     even when the underlying button has the disabled attribute
     (which suppresses pointer events on the button itself). */
  .validate-button-wrap {
    display: inline-flex;
  }

  .header-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-s);
  }

  .diff-toggle {
    border: none;
    background: transparent;
    color: var(--esphome-on-primary);
    padding: 2px 4px;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .diff-toggle[aria-pressed="true"] {
    background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
  }

  .diff-toggle:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .diff-toggle wa-icon {
    font-size: 18px;
  }

  .fullscreen-toggle {
    border: none;
    background: transparent;
    color: var(--esphome-on-primary);
    padding: 2px 4px;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .fullscreen-toggle wa-icon {
    font-size: 18px;
  }

  .fullscreen-toggle:hover {
    background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
  }

  .card-header--compact .fullscreen-toggle wa-icon {
    font-size: 16px;
  }

  .layout-toggle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .layout-toggle button {
    border: none;
    background: transparent;
    color: var(--esphome-on-primary);
    padding: 2px 4px;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .layout-toggle button[aria-pressed="true"] {
    background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
  }

  .layout-toggle button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .layout-toggle wa-icon {
    font-size: 18px;
  }

  .card-body {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .editor-layout {
    flex: 1;
    min-height: 0;
    display: grid;
    gap: 0;
  }

  .editor-layout--both {
    grid-template-columns: 1fr 1px 1fr;
  }

  .editor-layout--left {
    grid-template-columns: 1fr;
  }

  .editor-layout--right {
    grid-template-columns: 1fr;
  }

  .editor-pane {
    padding: var(--wa-space-m);
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
    min-height: 0;
    overflow: hidden;
  }

  .editor-pane--left {
    overflow-y: auto;
  }

  .editor-pane-title {
    margin: 0;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
  }

  .editor-pane-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .pane-divider {
    background: var(--wa-color-surface-border);
    width: 1px;
    align-self: stretch;
  }

  .editor-layout--left .editor-pane--right,
  .editor-layout--right .editor-pane--left {
    display: none;
  }

  @media (max-width: 900px) {
    .layout-toggle .split-btn {
      display: none;
    }

    /* Drop the card frame on mobile — the page wrapper already
       removes its padding so the editor occupies the full viewport.
       Border / border-radius / shadow at small widths just shave
       pixels off the editing area without adding any meaning. */
    .card {
      border: none;
      border-radius: 0;
      box-shadow: none;
    }
  }
`;
