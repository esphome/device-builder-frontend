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

  esphome-base-dialog.mandatory::part(close-button) {
    display: none;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
    box-sizing: border-box;
    height: 380px;
    overflow-y: auto;
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

  .welcome-logo {
    width: 64px;
    height: 64px;
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

  .welcome-screen {
    gap: var(--wa-space-xl);
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

  /* Step dots show progress through the wizard without numbering, which
     would be wrong when the step count varies by environment / use-case. */
  .steps {
    display: flex;
    gap: var(--wa-space-2xs);
    justify-content: center;
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
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
    gap: var(--wa-space-s);
  }

  .actions .spacer {
    flex: 1;
  }

  /* On phones the dialog goes full-screen (fullscreenMobileDialog), so the
     body fills the sheet instead of a fixed height — the switch and its
     description then have room without scrolling. */
  @media (max-width: 600px) {
    .body {
      height: 100%;
    }
  }
`;
