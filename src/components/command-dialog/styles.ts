import { css } from "lit";

/**
 * Styles for <esphome-command-dialog>. The terminal surface (log output,
 * success/error banner, toolbar layout, term buttons, streaming dot) is
 * rendered by the shared <esphome-process-terminal>; what remains here is the
 * dialog chrome and the styling for the controls this dialog slots into the
 * component — the queued overlay, the remote-builder sub-line, and the
 * reset-build-env suggestion. The --term-* tokens and .term-btn rules come
 * from the shared termTokens / termButtonStyles in the dialog's static styles.
 */
export const commandDialogStyles = css`
  /* Match logs-dialog width — same body (ANSI terminal output), same wrap
     budget. 900 wrapped routinely on retina laptops where the
     timestamp + [C][module:NNN] prefix ate horizontal real estate. */
  esphome-base-dialog {
    --width: min(1300px, 94vw);
  }
  esphome-base-dialog::part(header) {
    background: var(--esphome-primary);
    /* Right padding 0 so close sits flush — explicitly sized below. */
    padding: 0 0 0 var(--wa-space-m);
    height: 40px;
    box-sizing: border-box;
  }
  esphome-base-dialog::part(title) {
    color: var(--esphome-on-primary);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
  }
  esphome-base-dialog::part(body) {
    padding: 0;
    background: var(--term-bg);
    overflow: hidden;
  }
  esphome-base-dialog::part(footer) {
    display: none;
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
    font-family: var(--term-mono-font);
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

  /* "Building on <receiver_label>" sub-line, visible while a REMOTE-source
     job is in flight. Surfaced above the log area via the sub-line slot. */
  .remote-builder-sub-line {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 20px;
    border-bottom: 1px solid var(--term-border);
    font-family: var(--term-mono-font);
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
     palette: a hint, not a second error. Slotted into the component's
     suggestion slot. */
  .reset-suggestion {
    padding: 10px 20px;
    border-top: 1px solid var(--term-border);
    background: var(--term-bg-alt);
    font-family: var(--term-mono-font);
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

  /* Compile-elapsed counter, slotted lower-left where the streaming dot
     sits. Shares the dot's accent + a gentle pulse so the "still working"
     cue reads the same once download gives way to compilation. Clicking it
     opens the detail popover below. */
  .compile-timer-wrap {
    position: relative;
    display: inline-flex;
  }
  .compile-timer {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 2px 4px;
    margin: -2px -4px;
    border-radius: 4px;
    font-family: var(--term-mono-font);
    font-size: 12px;
    color: var(--term-accent);
    cursor: pointer;
  }
  .compile-timer:hover,
  .compile-timer:focus-visible {
    background: var(--term-bg-alt);
    outline: none;
  }
  .compile-timer wa-icon {
    font-size: 14px;
  }
  .compile-timer-detail {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    z-index: 2;
    min-width: 220px;
    padding: 10px 12px;
    background: var(--term-bg-alt);
    border: 1px solid var(--term-border);
    border-radius: 8px;
    font-family: var(--term-mono-font);
    font-size: 12px;
    color: var(--term-fg);
    box-shadow: 0 4px 16px rgb(0 0 0 / 35%);
  }
  .compile-timer-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 2px 0;
  }
  .compile-timer-row span:first-child {
    color: var(--term-fg-muted);
  }
  .compile-timer-hint {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--term-border);
    color: var(--term-fg-muted);
    line-height: 1.5;
  }
  .compile-timer--live {
    animation: compile-timer-pulse 1.5s ease-in-out infinite;
  }
  @keyframes compile-timer-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .compile-timer--live {
      animation: none;
    }
  }
`;
