import { css } from "lit";

export const deviceEditorStyles = css`
  :host {
    display: contents;
  }

  .card {
    background: var(--wa-color-surface-default);
    border-radius: var(--editor-border-radius, var(--wa-border-radius-l));
    border: var(
      --editor-border,
      var(--wa-border-width-s) solid var(--wa-color-surface-border)
    );
    box-shadow: var(--editor-shadow, var(--wa-elevation-02));
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--wa-space-s) var(--wa-space-m);
    background: var(--esphome-tint);
    color: var(--esphome-primary);
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  :host([navcollapsed]) .card-header {
    padding-left: var(--wa-space-2xs);
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

  ::slotted([slot="header-start"]) {
    margin-right: var(--wa-space-xs);
  }

  .editor-header-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .editor-header-titlerow {
    display: flex;
    align-items: baseline;
    gap: var(--wa-space-xs);
    min-width: 0;
  }

  .editor-header-title {
    margin: 0;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .editor-header-file {
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-normal);
    color: var(--esphome-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    /* Yield before the device name when the header is tight; the
       filename is the secondary half of the title row. */
    flex-shrink: 2;
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
    box-shadow: var(--esphome-primary-shadow);
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
    background: color-mix(
      in srgb,
      var(--esphome-primary) 35%,
      var(--wa-color-surface-default)
    );
    color: color-mix(in srgb, var(--esphome-on-primary), transparent 30%);
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
    background: var(--wa-color-surface-default);
    color: color-mix(in srgb, var(--wa-color-text-normal), transparent 55%);
    border-color: var(--wa-color-surface-border);
    cursor: not-allowed;
  }

  .install-fab {
    background: color-mix(
      in srgb,
      var(--esphome-primary) 10%,
      var(--wa-color-surface-default)
    );
    color: var(--esphome-primary);
    border-color: var(--esphome-tint-border);
  }

  .install-fab:hover:not(:disabled) {
    background: color-mix(
      in srgb,
      var(--esphome-primary) 18%,
      var(--wa-color-surface-default)
    );
    border-color: var(--esphome-primary);
  }

  .install-fab:disabled {
    background: var(--wa-color-surface-default);
    color: color-mix(in srgb, var(--esphome-primary), transparent 50%);
    border-color: var(--wa-color-surface-border);
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
    color: var(--esphome-primary);
    padding: 2px 4px;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .diff-toggle:hover:not(:disabled) {
    background: var(--esphome-tint-border);
  }

  .diff-toggle[aria-pressed="true"] {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .diff-toggle:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .diff-toggle wa-icon {
    font-size: 18px;
  }

  .layout-toggle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .layout-toggle button {
    border: none;
    background: transparent;
    color: var(--esphome-primary);
    padding: 2px 4px;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .layout-toggle button:hover:not(:disabled) {
    background: var(--esphome-tint-border);
  }

  .layout-toggle button[aria-pressed="true"] {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
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
    --pane-divider-width: 9px;
  }

  .editor-layout--both {
    grid-template-columns: 1fr var(--pane-divider-width) 1fr;
  }

  .editor-layout.dragging {
    cursor: col-resize;
    user-select: none;
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

  /* The floating Install / Validate / Save row overlays the
     bottom-right of the card body. Reserve room below the
     content so the last lines sit a header-matching
     var(--wa-space-m) above the buttons (button bottom inset +
     button height + the same top-of-pane gap the editor already
     has via .editor-pane's padding).
     Applied to:
     - .editor-pane--right always (the row sits over its bottom-right
       in both-pane + right-only layouts).
     - .editor-layout--left .editor-pane--left (board-info-only
       layout, where the right pane is hidden and the buttons now
       overlap the full-width left pane). */
  .editor-pane--right,
  .editor-layout--left .editor-pane--left {
    padding-bottom: calc(var(--wa-space-m) * 2 + 2.25rem);
  }

  .editor-pane-title {
    margin: 0;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
  }

  /* Document-level "configuration invalid" banner above the editor.
     A flex child of .editor-pane (column + gap), so it sits above the
     editor body and the body's flex:1 reclaims the rest. */
  .invalid-banner {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    gap: var(--wa-space-s);
    padding: var(--wa-space-s) var(--wa-space-m);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-danger-fill-quiet);
    border: var(--wa-border-width-s) solid var(--wa-color-danger-60);
    color: var(--wa-color-danger-text-normal);
  }

  .invalid-banner-icon {
    flex: 0 0 auto;
    font-size: 1.25rem;
    margin-top: 0.05rem;
    color: var(--wa-color-danger-60);
  }

  .invalid-banner-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    line-height: 1.4;
    min-width: 0;
  }

  .invalid-banner-error {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    word-break: break-word;
  }

  .invalid-banner-more {
    font-size: var(--wa-font-size-2xs);
    opacity: 0.85;
  }

  .editor-pane-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .pane-divider {
    align-self: stretch;
    position: relative;
    background: transparent;
    cursor: col-resize;
    touch-action: none;
  }

  .pane-divider::before {
    content: "";
    position: absolute;
    inset: 0 50%;
    width: 1px;
    transform: translateX(-50%);
    background: var(--wa-color-surface-border);
    transition:
      background 0.12s,
      width 0.12s;
  }

  .pane-divider:hover::before,
  .pane-divider:focus-visible::before,
  .pane-divider.dragging::before {
    background: var(--esphome-primary);
    width: 2px;
  }

  .pane-divider:focus-visible {
    /* Transparent outline keeps a ring in forced-colors mode. */
    outline: 2px solid transparent;
    box-shadow: var(--esphome-focus-ring-tight);
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

    /* Hug the always-present leading menu/back control to the edge on
       mobile, not the wide title indent of the pre-hamburger design. */
    .card-header {
      padding-left: var(--wa-space-2xs);
    }
  }
`;
