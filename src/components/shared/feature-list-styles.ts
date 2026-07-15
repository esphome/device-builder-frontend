import { css } from "lit";

/** Row styles for the shared feature list (renderFeatureList). */
export const featureListStyles = css`
  .feature-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
  }

  .feature-item {
    display: flex;
    align-items: flex-start;
    gap: var(--wa-space-s);
  }

  .feature-item wa-icon {
    font-size: 18px;
    color: var(--esphome-primary);
    flex-shrink: 0;
    margin-top: 1px;
  }

  .feature-item-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .feature-item-title {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
  }

  .feature-item-desc {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }
`;
