import { css } from "lit";

export const remoteBuildPanelStyles = css`
  :host {
    display: flex;
    flex-direction: column;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
    margin-bottom: var(--wa-space-s);
    flex: 1;
    min-height: 0;
  }

  /* Single accordion unit while collapsed: flush against the builder bar
     below, joining on a shared border line (page side squares the bar's
     top corners and overlaps the border). */
  :host([collapsed]) .panel {
    margin-bottom: 0;
  }

  /* Content shares the Device builder's horizontal gutter (the toolbar /
     card-grid inset inherited from esphome-layout); only the banner runs
     to the section edge like the builder header does. */
  .panel > :not(.banner) {
    margin-left: var(--content-gutter, var(--wa-space-l));
    margin-right: var(--content-gutter, var(--wa-space-l));
  }

  /* Square edge-to-edge strip mirroring .builder-stack-header exactly;
     shares the app header's gutter so icon and chevron line up with the
     logo and the kebab above. */
  .banner {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-xs) var(--content-gutter, var(--wa-space-l));
    margin: 0;
    border: none;
    border-top: var(--wa-border-width-s) solid var(--esphome-primary);
    border-bottom: var(--wa-border-width-s) solid var(--esphome-primary);
    border-radius: 0;
    background: transparent;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .banner:hover,
  .banner:focus-visible {
    background: var(--esphome-primary-light);
    outline: none;
  }

  .banner > wa-icon:first-child {
    font-size: 20px;
    color: var(--esphome-primary);
    flex-shrink: 0;
  }

  /* Title/pill/badges wrap among themselves; the chevron stays pinned.
     Baseline-aligned so the pill text sits on the title's baseline. */
  .banner-main {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--wa-space-xs) var(--wa-space-s);
    flex: 1;
    min-width: 0;
  }

  .banner-title {
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .banner-chevron {
    margin-left: auto;
    font-size: 20px;
    color: var(--wa-color-text-quiet);
    transition: transform 0.15s;
    flex-shrink: 0;
  }

  .banner[aria-expanded="true"] .banner-chevron {
    transform: rotate(180deg);
  }

  .banner-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px var(--wa-space-s);
    border-radius: var(--wa-border-radius-pill, 999px);
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-quiet);
  }

  .banner-badge--requests {
    background: var(--esphome-tint);
    color: var(--esphome-primary);
  }

  .listener-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px var(--wa-space-s);
    border-radius: var(--wa-border-radius-pill, 999px);
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
  }

  .listener-up {
    background: var(--wa-color-success-quiet, #d6f5dd);
    color: var(--wa-color-success-on-quiet, #036a1c);
  }

  .listener-down {
    background: var(--wa-color-warning-quiet, #fff3cd);
    color: var(--wa-color-warning-on-quiet, #8a6d3b);
  }

  .intro {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
  }

  .status-row {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    padding: var(--wa-space-s) 0;
  }

  .primary-action {
    align-self: flex-start;
    padding: 6px 14px;
    border: none;
    border-radius: var(--wa-border-radius-m);
    background: var(--esphome-primary);
    color: var(--esphome-on-primary, #fff);
    font-family: inherit;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    cursor: pointer;
  }

  .primary-action:hover,
  .primary-action:focus-visible {
    filter: brightness(1.1);
  }

  .request-card {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-m);
    border: var(--wa-border-width-s) solid var(--esphome-primary);
    border-radius: var(--wa-border-radius-m);
    background: var(--esphome-tint);
  }

  .request-card > wa-icon {
    font-size: 20px;
    color: var(--esphome-primary);
    flex-shrink: 0;
  }

  .request-body {
    flex: 1;
    min-width: 0;
  }

  .request-title {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .request-meta {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  .request-meta code {
    font-family: var(--wa-font-family-code);
  }

  .steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--wa-space-s);
  }

  .step {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    padding: var(--wa-space-m);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-lowered);
  }

  .step-label {
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .step-title {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .step-desc {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  .step-action {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    margin-top: auto;
    padding-top: var(--wa-space-xs);
  }

  .disabled-cta {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    padding: var(--wa-space-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
  }

  .fingerprint-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--wa-space-s) var(--wa-space-m);
    padding-top: var(--wa-space-s);
    border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  .fingerprint-label {
    font-weight: var(--wa-font-weight-semibold);
  }

  /* Cap the emoji grid's width: pin-emoji-grid space-evenly distributes
     across its host, and at full page width the glyphs drift too far
     apart to read as one fingerprint. Panel-scoped so the settings
     card keeps its own sizing. */
  .fingerprint-display {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: min(340px, 100%);
  }

  .fingerprint-versions {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-left: auto;
    text-align: right;
  }

  .fingerprint-versions code,
  .fingerprint-display code {
    font-family: var(--wa-font-family-code);
    word-break: break-all;
  }

  /* Default grid stretch keeps side-by-side cards the same height; the
     grid flexes into the section's leftover viewport space. */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: var(--wa-space-m);
    flex: 1;
    min-height: 0;
  }

  .card {
    display: flex;
    flex-direction: column;
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    padding: var(--wa-space-s) var(--wa-space-m) var(--wa-space-m);
  }

  .card-heading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--wa-space-xs);
    padding-bottom: var(--wa-space-s);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .heading-count {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-normal);
    color: var(--wa-color-text-quiet);
  }

  .heading-action {
    padding: 2px 10px;
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    color: var(--wa-color-text-normal);
    font: inherit;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    cursor: pointer;
  }

  .heading-action:hover,
  .heading-action:focus-visible {
    background: var(--wa-color-surface-border);
  }

  .heading-action--quiet {
    background: transparent;
    border-color: transparent;
    color: var(--wa-color-text-quiet);
  }

  .heading-action--quiet:hover,
  .heading-action--quiet:focus-visible {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
  }

  .peer-line {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-xs) 0;
    border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .peer-line wa-icon {
    font-size: 18px;
    color: var(--wa-color-text-quiet);
    flex-shrink: 0;
  }

  .peer-line-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .peer-line-title {
    display: flex;
    align-items: center;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
  }

  .peer-line-meta {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  /* A long build history scrolls inside the card instead of stretching
     it past the viewport-filled section. */
  .jobs {
    flex: 1;
    min-height: 0;
    max-height: 70vh;
    overflow-y: auto;
  }

  /* Card already provides the horizontal inset. */
  .job {
    padding-left: var(--wa-space-2xs);
    padding-right: var(--wa-space-2xs);
  }

  .group-label {
    padding-left: var(--wa-space-2xs);
  }
`;
