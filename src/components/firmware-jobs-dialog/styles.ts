import { css } from "lit";

export const firmwareJobsDialogStyles = css`
  wa-dialog {
    --width: min(620px, 95vw);
  }

  wa-dialog::part(header) {
    background: var(--esphome-primary);
    padding: 0 var(--wa-space-m);
    height: 40px;
    box-sizing: border-box;
  }

  wa-dialog::part(title) {
    color: var(--esphome-on-primary);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
  }

  wa-dialog::part(close-button__base) {
    background: transparent;
    border: none;
    box-shadow: none;
    padding: 0;
    min-width: unset;
    min-height: unset;
    color: var(--esphome-on-primary);
    cursor: pointer;
  }

  wa-dialog::part(footer) {
    display: none;
  }

  wa-dialog::part(body) {
    padding: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    padding: var(--wa-space-s) var(--wa-space-m);
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-default);
  }

  .toolbar .spacer {
    flex: 1;
  }

  .tool-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: var(--wa-border-radius-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-default);
    font-family: inherit;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
    cursor: pointer;
    transition:
      background 0.1s,
      border-color 0.1s,
      color 0.1s;
  }

  .tool-btn:hover {
    background: var(--wa-color-surface-lowered);
    border-color: var(--wa-color-text-quiet);
  }

  .tool-btn wa-icon {
    font-size: 16px;
  }

  .tool-btn--ghost {
    background: transparent;
    border-color: transparent;
    color: var(--wa-color-text-quiet);
  }

  .tool-btn--ghost:hover {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
  }

  .empty {
    padding: var(--wa-space-2xl) var(--wa-space-m);
    text-align: center;
    color: var(--wa-color-text-quiet);
  }

  .empty wa-icon {
    display: block;
    margin: 0 auto var(--wa-space-s);
    font-size: 48px;
    opacity: 0.4;
  }

  .empty-title {
    font-size: var(--wa-font-size-m);
    color: var(--wa-color-text-normal);
    margin-bottom: var(--wa-space-2xs);
  }

  .empty-desc {
    font-size: var(--wa-font-size-s);
  }

  .jobs {
    display: flex;
    flex-direction: column;
    gap: 0;
    /* Horizontal inset matches the toolbar's left/right padding
       (var(--wa-space-m)) so each row's hover/focus background lines
       up with the "Reset build environment" / "Clear history" buttons
       sitting directly above. Top stays tight so the first row hugs
       the toolbar separator; small bottom padding keeps the last row
       off the dialog edge. */
    padding: var(--wa-space-2xs) var(--wa-space-m) var(--wa-space-xs);
    max-height: 60vh;
    overflow-y: auto;
  }

  .group-label {
    padding: var(--wa-space-s) var(--wa-space-m) var(--wa-space-2xs);
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .job {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-s) var(--wa-space-m);
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    transition: background 0.1s;
    text-align: left;
    background: transparent;
    border: none;
    font-family: inherit;
    color: inherit;
    width: 100%;
  }

  .job:hover,
  .job:focus-visible {
    background: var(--wa-color-surface-lowered);
    outline: none;
  }

  .job-icon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
    color: var(--esphome-primary);
  }

  .job-icon--terminal {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-quiet);
  }

  .job-icon wa-icon {
    font-size: 18px;
  }

  .job-content {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .job-name {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .job-meta {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
  }

  /* Lives on its own line so a long receiver label doesn't push the
     status / timestamp off-screen on narrow viewports. */
  .job-source {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    margin-top: 2px;
  }

  .job-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .job-status wa-spinner {
    font-size: 12px;
    --indicator-color: var(--esphome-primary);
    --track-color: transparent;
  }

  .job-status wa-icon {
    font-size: 13px;
  }

  .job-time {
    white-space: nowrap;
  }

  .job-status--success {
    color: var(--esphome-success);
  }

  .job-status--error {
    color: var(--esphome-error);
  }

  .progress {
    margin-top: 4px;
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: var(--wa-color-surface-lowered);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--esphome-primary);
    transition: width 0.2s;
  }

  .row-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: var(--wa-border-radius-m);
    border: none;
    background: transparent;
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    transition:
      background 0.1s,
      color 0.1s;
  }

  .row-action:hover {
    background: color-mix(in srgb, var(--esphome-error), transparent 90%);
    color: var(--esphome-error);
  }

  .row-action wa-icon {
    font-size: 18px;
  }

  .row-status-icon {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
  }

  .row-status-icon--success {
    color: var(--esphome-success);
  }

  .row-status-icon--error {
    color: var(--esphome-error);
  }

  .row-status-icon--cancelled {
    color: var(--wa-color-text-quiet);
  }
`;
