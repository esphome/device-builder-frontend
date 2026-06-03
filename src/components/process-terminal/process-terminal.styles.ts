import { css } from "lit";

import { MOBILE_BREAKPOINT } from "../../styles/breakpoints.js";

/**
 * Terminal color tokens. Shared by ``<esphome-process-terminal>`` and its
 * driver dialogs (command / logs / firmware-install) so slotted controls —
 * authored in the *driver's* shadow root and projected through a ``<slot>`` —
 * resolve the same ``--term-*`` palette the component's own chrome uses.
 *
 * Superset of the values the three dialogs each declared inline before #346.
 */
export const termTokens = css`
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
`;

/**
 * Terminal button chrome. Authored in two shadow roots: the component renders
 * its own ``.term-btn`` (none today, but kept here for symmetry) and every
 * driver slots ``.term-btn`` controls into the toolbar — a ``<slot>`` projects
 * light-DOM children that are styled by the *host where they're authored*, so
 * the class rules must live wherever the markup is created. Both the component
 * and the drivers include this chunk; the values live in exactly one file.
 */
export const termButtonStyles = css`
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

  /* A driver slots its toolbar controls inside one wrapper element; display:
     contents removes that wrapper's box so the individual buttons promote to
     flex items of the component's .terminal-toolbar and pick up its gap +
     wrapping, instead of being squashed into one item. */
  .toolbar-slot {
    display: contents;
  }

  /* On narrow viewports collapse labelled icon buttons to icon-only so the
     toolbar stays on one row instead of wrapping (#542 follow-up). The label
     is visually hidden, not removed, so it still names the button for screen
     readers; the title attribute keeps the tooltip. Icon-less buttons (e.g.
     the command dialog's text-only Close) have no wa-icon, so they keep their
     label and are never left empty. */
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    .term-btn:has(wa-icon) .term-btn__label {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  }
`;

/**
 * Layout + chrome the ``<esphome-process-terminal>`` element renders itself:
 * the log surface, the status banner (stream) / status card (card variant),
 * the progress bar, the streaming dot, and the toolbar container. Slotted
 * driver content (sub-line / overlay / suggestion / toolbar buttons) is styled
 * by the driver; only what the component renders lives here.
 */
export const processTerminalStyles = css`
  :host {
    display: block;
  }

  /* ── stream variant ─────────────────────────────────────────── */
  /* Height is variable-driven so a consumer can fill the dialog when
     expanded / on mobile (logs-dialog overrides these to 100% / none). */
  .content {
    display: flex;
    flex-direction: column;
    height: var(--process-terminal-height, 60vh);
    min-height: var(--process-terminal-min-height, 300px);
    max-height: var(--process-terminal-max-height, 70vh);
    overflow: hidden;
  }
  /* Anchor the overlay slot's positioning context on .log-area so a queued
     overlay covers only the log; toolbar/banner stay interactive. */
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

  .terminal-toolbar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    /* Wrap when cramped (narrow / mobile) so labelled buttons stay on-screen
       instead of running off the right edge. */
    flex-wrap: wrap;
    gap: var(--wa-space-xs);
    padding: 6px var(--wa-space-m);
    /* On the full-screen mobile sheet the side padding widens (see
       fillTerminalOnMobile) so the end buttons (States / Stop) clear the
       phone's curved corners; everywhere else it falls back to the flat
       padding above, so the windowed / card terminal is byte-identical. */
    padding-left: var(--process-terminal-toolbar-pad-x, var(--wa-space-m));
    padding-right: var(--process-terminal-toolbar-pad-x, var(--wa-space-m));
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
    animation: process-terminal-pulse 1.5s infinite;
  }
  @keyframes process-terminal-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .streaming-dot {
      animation: none;
    }
  }

  /* ── card variant (firmware install) ────────────────────────── */
  .card {
    display: flex;
    flex-direction: column;
    /* Resolves to auto when the host height is indefinite (compact card);
       fills when a driver gives the host a definite height (firmware install,
       expanded log on the full-screen mobile sheet — #516). */
    height: 100%;
  }
  /* Driver's slotted block (collapsible log + any instructions) becomes the
     growing, internally-scrolling region when the card is given a definite
     height; no-op while the card is auto-height. The footer (toolbar-right)
     then pins to the bottom as the last flex item. Scoped to the card-only
     slot, so the stream variant's slots are untouched. */
  slot[name="status-extra"]::slotted(*) {
    flex: 1 1 auto;
    min-height: 0;
  }
  .status {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--wa-space-m);
    padding: var(--wa-space-l) 0;
  }
  .status wa-spinner {
    font-size: 36px;
    --indicator-color: var(--esphome-primary);
    --track-color: color-mix(in srgb, var(--esphome-primary), transparent 80%);
  }
  .status-icon {
    font-size: 42px;
  }
  .status-icon--success {
    color: var(--esphome-success);
  }
  .status-icon--error {
    color: var(--esphome-error);
  }
  .status-text {
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }
  .status-detail {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    max-width: 380px;
    line-height: 1.5;
  }

  .progress-bar {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: var(--wa-color-surface-lowered);
    overflow: hidden;
    margin-top: var(--wa-space-xs);
  }
  .progress-bar-fill {
    height: 100%;
    border-radius: 3px;
    background: var(--esphome-primary);
    transition: width 0.2s;
  }
`;

// Declarations that stretch the stream terminal to fill its dialog body.
const fillTerminalDecls = css`
  height: 100%;
  --process-terminal-height: 100%;
  --process-terminal-min-height: 0;
  --process-terminal-max-height: none;
`;

/**
 * Make ``<esphome-process-terminal>`` fill its dialog body. A consumer drops
 * this where the dialog goes full-bleed — e.g. ``:host([expanded]) ${fillTerminal}``
 * for an expand toggle.
 */
export const fillTerminal = css`
  esphome-process-terminal {
    ${fillTerminalDecls}
  }
`;

/**
 * Mobile companion to ``fullscreenMobileDialog``: the content-heavy stream
 * terminal fills the full-screen sheet the dialog opens at the shared mobile
 * breakpoint. Add to a stream dialog's ``static styles``.
 */
export const fillTerminalOnMobile = css`
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    ${fillTerminal}
    /* The dialog is edge-to-edge here, so the toolbar's end buttons sit in the
       phone's curved bottom corners. Widen the side padding to pull them in;
       the var inherits into the terminal's shadow DOM where the toolbar reads
       it. Uniform across devices, no viewport-fit / safe-area dependency. */
    esphome-process-terminal {
      --process-terminal-toolbar-pad-x: 20px;
    }
  }
`;
