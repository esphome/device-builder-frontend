import { css } from "lit";

export const onboardingWizardStyles = css`
  esphome-base-dialog {
    --width: min(520px, calc(100vw - 24px));
  }

  /* Let the longer step titles wrap instead of truncating (the base dialog
     ellipsizes by default), so nothing is chopped on a narrow / mobile sheet. */
  esphome-base-dialog::part(title-text) {
    white-space: normal;
  }

  esphome-base-dialog::part(close-button) {
    display: none;
  }

  esphome-base-dialog::part(body) {
    padding-top: var(--wa-space-s);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
    box-sizing: border-box;
    min-height: 260px;
    overflow-y: auto;
  }

  /* The existing-server step carries the toggle plus the always-visible
     explainer; give it enough height that the explainer isn't below the
     fold on desktop (viewport-capped so short screens still fit). */
  .body:has(.existing-server) {
    height: min(560px, 72vh);
  }

  .intro {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
    margin: 0;
  }

  .intro wa-icon {
    font-size: 18px;
    vertical-align: -3px;
    margin-right: var(--wa-space-2xs);
    color: var(--esphome-primary);
  }

  .choices {
    margin-top: var(--wa-space-xs);
  }

  .welcome-logo {
    width: 88px;
    height: 88px;
  }

  .welcome-screen,
  .tour-offer {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: var(--wa-space-s);
  }

  .existing-server {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--wa-space-s);
    justify-content: flex-start;
  }

  .existing-server .tour-offer-icon {
    margin-top: var(--wa-space-s);
  }

  .remote-toggle {
    display: flex;
    align-items: center;
    gap: var(--wa-space-m);
    width: 100%;
    text-align: left;
    box-sizing: border-box;
    margin-top: var(--wa-space-s);
    padding: var(--wa-space-m);
    border: 1px solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
  }

  .remote-toggle-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .remote-toggle-title {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
  }

  .remote-toggle-desc {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    line-height: 1.4;
  }

  .remote-feature-box {
    width: 100%;
    box-sizing: border-box;
    margin: var(--wa-space-s) 0 0;
    padding: var(--wa-space-s) var(--wa-space-m);
    background: var(--wa-color-surface-lowered);
    border-radius: var(--wa-border-radius-m);
    text-align: left;
  }

  .remote-feature-heading {
    margin: 0 0 var(--wa-space-2xs);
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-quiet);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .welcome-screen {
    gap: var(--wa-space-l);
  }

  .welcome-screen .intro {
    font-size: var(--wa-font-size-m);
    max-width: 36ch;
  }

  .tour-offer-icon {
    font-size: 48px;
    color: var(--esphome-primary);
  }

  .tour-ready {
    margin: 0;
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .steps {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    gap: var(--wa-space-2xs);
  }

  .step-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--wa-color-surface-border);
  }

  .step-dot.active {
    background: var(--esphome-primary);
  }

  .actions {
    position: relative;
    width: 100%;
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
    gap: var(--wa-space-s);
  }

  .actions .spacer {
    flex: 1;
  }

  .actions .btn {
    border: var(--wa-border-width-s) solid transparent;
  }

  .actions .btn--cancel {
    border-color: var(--wa-color-surface-border);
  }

  @media (max-width: 600px) {
    .body,
    .body:has(.existing-server) {
      height: 100%;
      min-height: 0;
    }
  }
`;
