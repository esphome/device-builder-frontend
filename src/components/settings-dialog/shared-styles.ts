import { css } from "lit";

/** Width at/below which the settings dialog switches to its compact layout:
 *  the sidebar stacks above the content as a wrapped nav, and the dialog goes
 *  full-screen. This is wider than the shared phone cutoff (MOBILE_BREAKPOINT,
 *  600px) on purpose -- between 600 and 700 a centered box with the nav already
 *  stacked on top floated as an awkward half-collapsed panel, so the dialog
 *  commits to the full-screen sheet as soon as the nav stacks. settings-dialog.ts
 *  passes this value to fullscreenMobileDialog() so the two stay in lockstep. */
export const SETTINGS_DIALOG_BREAKPOINT = 700;

export const settingsSharedStyles = css`
  esphome-base-dialog {
    --width: min(800px, 95vw);
  }

  /* Primary header bar + title come from primaryDialogHeaderStyles (shared). */

  esphome-base-dialog::part(footer) {
    display: none;
  }

  esphome-base-dialog::part(body) {
    padding: 0;
  }

  .layout {
    display: flex;
    height: min(500px, 70vh);
  }

  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: var(--wa-color-surface-default);
    border-right: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    padding: var(--wa-space-m) var(--wa-space-xs);
    overflow-y: auto;
  }

  .nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: 8px var(--wa-space-s);
    border: none;
    background: transparent;
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-s);
    font-family: inherit;
    color: var(--wa-color-text-normal);
    cursor: pointer;
    text-align: left;
    transition:
      background 0.12s,
      color 0.12s,
      text-shadow 0.12s;
  }

  .nav-item:hover,
  .nav-item--active {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
    /* Fake bold via text-shadow so hover doesn't reflow and drop the cursor. */
    text-shadow:
      0.4px 0 0 currentColor,
      -0.4px 0 0 currentColor;
  }

  .nav-item:hover wa-icon,
  .nav-item--active wa-icon {
    color: var(--wa-color-text-normal);
  }

  .nav-item wa-icon {
    font-size: 18px;
    color: var(--wa-color-text-quiet);
    transition: color 0.12s;
  }

  /* Notification dot on a nav item. Pushed to the right by the
     flex layout (margin-left: auto) so the icon + label stay
     left-anchored. Sized to match the existing menu-btn-badge
     on the header gear so the two notification surfaces use
     the same visual language. Currently rendered when the
     'Send builds' section has offloader-side alerts to act on
     (pin_mismatch / peer_revoked). */
  .nav-item-dot {
    margin-left: auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--wa-color-danger-fill-loud);
    flex-shrink: 0;
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .content-body {
    flex: 1;
    padding: 0 var(--wa-space-l);
    padding-bottom: var(--wa-space-l);
    overflow-y: auto;
  }

  /* Inline text link inside section copy. Single source for every settings
     section (language help, the ESPHome Desktop link, …). */
  .settings-inline-link {
    color: var(--esphome-primary);
    text-decoration: none;
  }
  .settings-inline-link:hover {
    text-decoration: underline;
  }

  /* Compact layout: the dialog goes full-screen (see fullscreenMobileDialog in
     settings-dialog.ts, driven by the same SETTINGS_DIALOG_BREAKPOINT) and the
     nav stacks above the content. height: 100% fills the full-screen sheet so
     the content body scrolls instead of the dialog collapsing to content. */
  @media (max-width: ${SETTINGS_DIALOG_BREAKPOINT}px) {
    .layout {
      flex-direction: column;
      height: 100%;
    }
    .sidebar {
      width: auto;
      border-right: none;
      border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    }
    .nav {
      flex-direction: row;
      flex-wrap: wrap;
    }
  }
`;

export const settingsRowStyles = css`
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-m);
    padding: var(--wa-space-m) 0;
    padding-bottom: var(--wa-space-l);
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .row:last-child {
    border-bottom: none;
  }

  /* Stacked variant: input drops below the label/description so the
     description has the full row width to wrap into instead of
     fighting a 180px-wide select on the right. Used by rows whose
     description is long enough to wrap into the input column
     (Theme, Language, Cache retention). */
  .row--stacked {
    flex-direction: column;
    align-items: stretch;
    gap: var(--wa-space-s);
  }

  .row-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .row-title {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .row-desc {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  wa-select {
    min-width: 180px;
  }

  .toggle {
    position: relative;
    width: 40px;
    height: 22px;
    border: none;
    border-radius: 11px;
    background: var(--wa-color-surface-border);
    cursor: pointer;
    transition: background 0.15s;
    padding: 0;
    flex-shrink: 0;
  }

  .toggle[aria-checked="true"] {
    background: var(--esphome-primary);
  }

  .toggle::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    transition: transform 0.15s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .toggle[aria-checked="true"]::after {
    transform: translateX(18px);
  }

  .section-intro {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    margin: 0 0 var(--wa-space-m);
  }

  /* When intro follows a heading, tighten the top gap so they
     read as one heading-block instead of two stacked paragraphs. */
  .section-heading + .section-intro {
    margin-top: var(--wa-space-2xs);
  }

  .section-heading {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: var(--wa-space-xl) 0 var(--wa-space-2xs);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--wa-space-xs);
  }
`;

export const peerRowStyles = css`
  .peer-row .row-title {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
  }

  /* Destructive remove/unpair icon button: neutral bordered square at
     rest, error tint on hover/focus. Single source for both the
     approved-senders Remove (build-server-section) and the offloader
     unpair trash (build-offload-pairing-row). */
  .peer-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    flex-shrink: 0;
  }

  .peer-remove wa-icon {
    font-size: 16px;
  }

  .peer-remove:hover,
  .peer-remove:focus-visible {
    background: color-mix(in srgb, var(--esphome-error), white 90%);
    color: var(--esphome-error);
    border-color: var(--esphome-error);
  }

  .peer-remove:focus-visible {
    outline: none;
    box-shadow: var(--esphome-focus-ring);
  }

  .peer-connection-pill {
    display: inline-block;
    padding: 1px 6px;
    margin-left: var(--wa-space-xs);
    border-radius: 4px;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .peer-connection-connected {
    background: color-mix(in srgb, var(--esphome-success, #16a34a), transparent 80%);
    color: var(--esphome-success, #16a34a);
  }

  .peer-connection-disconnected {
    background: color-mix(in srgb, var(--wa-color-neutral-500, #6b7280), transparent 80%);
    color: var(--wa-color-neutral-500, #6b7280);
  }

  .peer-connection-connecting {
    background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 80%);
    color: var(--esphome-warning, #f59e0b);
  }

  /*
   * "Show details" disclosure under an approved peer row. Mirrors
   * the .pin-hex styling shape (small / quiet / pointer cursor on
   * the summary) so the two disclosures feel like the same widget
   * across the section. The body is a two-column dl so field
   * labels align in their own gutter.
   */
  .peer-details {
    margin-top: var(--wa-space-2xs);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  .peer-details summary {
    cursor: pointer;
    user-select: none;
  }

  .peer-details-list {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px var(--wa-space-s);
    margin: 4px 0 0 0;
    padding: 0;
  }

  .peer-details-list dt {
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
  }

  .peer-details-list dd {
    margin: 0;
    color: var(--wa-color-text-normal);
  }

  .peer-details-list code {
    font-family: var(--wa-font-family-code);
    word-break: break-all;
  }

  .peer-details-desc {
    display: block;
    margin-top: 2px;
    color: var(--wa-color-text-quiet);
  }
`;
