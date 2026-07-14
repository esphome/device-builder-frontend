import { css } from "lit";

export const onboardingWizardStyles = css`
  esphome-base-dialog {
    --width: min(520px, calc(100vw - 24px));
  }

  esphome-base-dialog.mandatory::part(close-button) {
    display: none;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
    box-sizing: border-box;
    height: 300px;
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

  @media (max-width: 600px), (max-height: 600px) {
    .body {
      height: min(390px, calc(100dvh - 190px));
    }
  }
`;
