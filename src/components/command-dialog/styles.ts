import { css } from "lit";

import { MOBILE_DIALOG_BREAKPOINT } from "../../styles/dialog-mobile.js";

export const commandDialogStyles = css`
  :host {
    --term-bg: #1e1e1e;
    --term-bg-alt: #252526;
    --term-fg: #d4d4d4;
    --term-fg-muted: #808080;
    --term-border: #3c3c3c;
    --term-hover: #2a2d2e;
    --term-accent: #4ec9b0;
    --term-error: #f44747;
    --term-success: #6a9955;
  }

  :host([light]) {
    --term-bg: #f5f5f5;
    --term-bg-alt: #e8e8e8;
    --term-fg: #1e1e1e;
    --term-fg-muted: #6e6e6e;
    --term-border: #d0d0d0;
    --term-hover: #dcdcdc;
    --term-accent: #0d8a6f;
    --term-error: #c02020;
    --term-success: #3d7a28;
  }

  /* Match logs-dialog width — same body (ANSI terminal output), same wrap
     budget. 900 wrapped routinely on retina laptops where the
     timestamp + [C][module:NNN] prefix ate horizontal real estate. */
  wa-dialog {
    --width: min(1300px, 94vw);
  }
  wa-dialog::part(header) {
    background: var(--esphome-primary);
    /* Right padding 0 so close sits flush — explicitly sized below. */
    padding: 0 0 0 var(--wa-space-m);
    height: 40px;
    box-sizing: border-box;
  }
  wa-dialog::part(title) {
    color: var(--esphome-on-primary);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
  }
  wa-dialog::part(body) {
    padding: 0;
    background: var(--term-bg);
    overflow: hidden;
  }
  wa-dialog::part(footer) {
    display: none;
  }

  .content {
    display: flex;
    flex-direction: column;
    height: 60vh;
    min-height: 300px;
    max-height: 70vh;
    overflow: hidden;
  }

  /* Fill the mobile full-screen sheet (fullscreenMobileDialog). #41 */
  @media (max-width: ${MOBILE_DIALOG_BREAKPOINT}px) {
    .content {
      height: 100%;
      min-height: 0;
      max-height: none;
    }
  }
  /* Anchor the queued overlay's positioning context on .log-area (not
     .content) so the overlay covers only the log — toolbar/banner stay
     interactive regardless of viewport height. */
  .log-area {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }
  esphome-ansi-log {
    flex: 1;
    min-height: 0;
    --log-height: 100%;
  }
  esphome-ansi-log::part(container) {
    border-radius: 0;
  }

  .queued-overlay {
    position: absolute;
    inset: 0;
    background: var(--term-bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 24px;
    text-align: center;
    font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
    color: var(--term-fg);
    z-index: 1;
  }
  .queued-overlay wa-icon[name="timer-sand"] {
    font-size: 48px;
    color: var(--term-accent);
    animation: queued-pulse 2s ease-in-out infinite;
  }
  @keyframes queued-pulse {
    0%,
    100% {
      opacity: 0.7;
    }
    50% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .queued-overlay wa-icon[name="timer-sand"] {
      animation: none;
    }
  }
  .queued-title {
    font-size: 16px;
    font-weight: 700;
  }
  .queued-message {
    font-size: 13px;
    color: var(--term-fg-muted);
    max-width: 420px;
    line-height: 1.5;
  }

  .status-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-top: 1px solid var(--term-border);
    font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
    font-size: 14px;
    font-weight: 600;
  }
  .status-banner wa-icon {
    font-size: 28px;
    flex-shrink: 0;
  }
  .status-banner--success {
    background: color-mix(in srgb, var(--term-success), transparent 85%);
    color: var(--term-success);
  }
  .status-banner--error {
    background: color-mix(in srgb, var(--term-error), transparent 85%);
    color: var(--term-error);
  }

  /* "Building on <receiver_label>" sub-line, visible while a REMOTE-source
     job is in flight. Surfaced above the log area. */
  .remote-builder-sub-line {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 20px;
    border-bottom: 1px solid var(--term-border);
    font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
    font-size: 12px;
    color: var(--wa-color-text-quiet, #888);
  }
  .remote-builder-sub-line wa-icon {
    font-size: 16px;
    flex-shrink: 0;
  }
  .remote-builder-sub-line .spacer {
    flex: 1;
  }

  /* "Build locally instead" override link. Inline text link rather than
     button — the row is informational chrome, not a primary action. */
  .force-local-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--esphome-primary, #1e88e5);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .force-local-link:hover:not(:disabled),
  .force-local-link:focus-visible {
    text-decoration-thickness: 2px;
    outline: none;
  }
  .force-local-link:disabled {
    color: var(--wa-color-text-quiet, #888);
    cursor: not-allowed;
    text-decoration: none;
  }

  /* Reset-build-env suggestion — install/compile failures only. Muted
     palette: a hint, not a second error. */
  .reset-suggestion {
    padding: 10px 20px;
    border-top: 1px solid var(--term-border);
    background: var(--term-bg-alt);
    font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
    font-size: 12px;
    line-height: 1.5;
    color: var(--term-fg-muted);
  }
  .reset-suggestion-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--term-accent);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .reset-suggestion-link:hover,
  .reset-suggestion-link:focus-visible {
    color: var(--term-accent);
    text-decoration-thickness: 2px;
    outline: none;
  }
  .terminal-toolbar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    padding: 6px var(--wa-space-m);
    background: var(--term-bg-alt);
    border-top: 1px solid var(--term-border);
  }
  .terminal-toolbar .spacer {
    flex: 1;
  }

  .streaming-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--term-accent);
    animation: pulse 1.5s infinite;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  .term-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    font-family: "SF Mono", "Fira Code", monospace;
    cursor: pointer;
    border: 1px solid var(--term-border);
    transition:
      background 0.1s,
      border-color 0.1s;
  }
  .term-btn wa-icon {
    font-size: 14px;
  }
  .term-btn--ghost {
    background: transparent;
    color: var(--term-fg-muted);
  }
  .term-btn--ghost:hover {
    background: var(--term-hover);
    color: var(--term-fg);
    border-color: var(--term-fg-muted);
  }
  .term-btn--ghost.is-active {
    background: color-mix(in srgb, var(--term-accent), transparent 85%);
    color: var(--term-accent);
    border-color: color-mix(in srgb, var(--term-accent), transparent 60%);
  }
  .term-btn--stop {
    background: color-mix(in srgb, var(--term-error), transparent 85%);
    color: var(--term-error);
    border-color: color-mix(in srgb, var(--term-error), transparent 60%);
  }
  .term-btn--stop:hover {
    background: color-mix(in srgb, var(--term-error), transparent 75%);
  }
  .term-btn--start {
    background: color-mix(in srgb, var(--term-accent), transparent 85%);
    color: var(--term-accent);
    border-color: color-mix(in srgb, var(--term-accent), transparent 60%);
  }
  .term-btn--start:hover {
    background: color-mix(in srgb, var(--term-accent), transparent 75%);
  }
`;
