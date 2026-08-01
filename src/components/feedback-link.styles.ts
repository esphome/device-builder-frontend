import { css } from "lit";

/**
 * The feedback surfaces' shared link-row look: the dialog's screens and
 * the device picker render the same anchor/button rows, so the styling
 * lives once here.
 */
export const feedbackLinkStyles = css`
  .description {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
    margin: 0 0 var(--wa-space-m);
  }

  .links {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
  }

  .link {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-xs) var(--wa-space-s);
    border-radius: var(--wa-border-radius-m);
    /* A faint grey outline at rest gives each row a quiet edge; the brand
       wash takes over on hover. No glow, no ring. */
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: transparent;
    color: var(--wa-color-text-normal);
    font-size: var(--wa-font-size-s);
    text-decoration: none;
    transition:
      background 0.12s,
      border-color 0.12s;
  }

  /* The drill row is a button; strip the native chrome so it matches the
     anchor rows. */
  button.link {
    width: 100%;
    text-align: left;
    font-family: inherit;
    cursor: pointer;
  }

  button.link:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .link:hover {
    border-color: transparent;
    background: var(--esphome-tint);
  }

  .link:hover .link-external,
  .link:focus-visible .link-external {
    opacity: 1;
  }

  .link-icon {
    font-size: 20px;
    color: var(--esphome-primary);
    flex-shrink: 0;
  }

  .link-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .link-desc {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    line-height: 1.4;
  }

  .link-external {
    font-size: 14px;
    color: var(--wa-color-text-quiet);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.12s;
  }

  /* The drill chevron is the only cue a row navigates deeper, so it stays
     visible at rest (unlike the hover-only external-link glyph) for touch
     users with no hover state. */
  .link-chevron {
    font-size: 18px;
    color: var(--wa-color-text-quiet);
    flex-shrink: 0;
  }

  .link wa-spinner {
    font-size: 16px;
    flex-shrink: 0;
  }

  .link.featured {
    padding: var(--wa-space-s) var(--wa-space-m);
    border-color: var(--esphome-primary);
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .link.featured:hover {
    border-color: var(--esphome-primary-hover);
    background: var(--esphome-primary-hover);
  }

  .link.featured .link-icon,
  .link.featured .link-external {
    color: var(--esphome-on-primary);
  }

  .link.featured .link-external {
    opacity: 1;
  }

  .link.featured .link-label {
    font-weight: var(--wa-font-weight-bold);
  }
`;
