import { css } from "lit";

export const onboardingWizardStyles = css`
  esphome-base-dialog {
    --width: 520px;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
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
`;
