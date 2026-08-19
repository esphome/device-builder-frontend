/**
 * Shared styles for the inline notice banners shown above a section's form:
 * the `.notice` box, its `.body` column, and the `.cta` button.
 * Accent color is `--notice-accent`, defaulting to the warning color; set
 * it on `:host` to retheme (the migration notice sets the migration purple).
 */
import { css } from "lit";

export const noticeBannerStyles = css`
  .notice {
    display: flex;
    align-items: flex-start;
    gap: var(--wa-space-s);
    margin-bottom: var(--wa-space-m);
    padding: var(--wa-space-s) var(--wa-space-m);
    border: var(--wa-border-width-s) solid
      var(--notice-accent, var(--esphome-warning, #f59e0b));
    background: color-mix(
      in srgb,
      var(--notice-accent, var(--esphome-warning, #f59e0b)),
      transparent 90%
    );
    border-radius: var(--wa-border-radius-m);
    color: var(--wa-color-text-normal);
    font-size: var(--wa-font-size-s);
    line-height: 1.5;
  }

  .notice wa-icon {
    flex-shrink: 0;
    font-size: 20px;
    color: var(--notice-accent, var(--esphome-warning, #f59e0b));
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
    flex: 1;
    min-width: 0;
  }

  .body .text {
    margin: 0;
  }

  .cta {
    align-self: flex-start;
    padding: var(--wa-space-2xs) var(--wa-space-m);
    border: none;
    border-radius: var(--wa-border-radius-m);
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    font-family: inherit;
    font-size: inherit;
    font-weight: var(--wa-font-weight-bold);
    cursor: pointer;
    transition:
      background 0.12s,
      opacity 0.12s;
  }

  .cta:hover:not(:disabled) {
    background: var(--esphome-primary-hover);
  }

  .cta:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .cta-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--wa-space-s);
  }

  .cta--secondary {
    background: transparent;
    color: var(--esphome-primary);
    border: var(--wa-border-width-s) solid var(--esphome-primary);
  }

  .cta--secondary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
  }
`;

export const noticeCloseStyles = css`
  .notice-close {
    flex-shrink: 0;
    background: transparent;
    border: none;
    padding: 4px;
    cursor: pointer;
    color: var(--wa-color-text-quiet);
    border-radius: var(--wa-border-radius-s);
  }

  .notice-close:hover {
    color: var(--wa-color-text-normal);
  }

  .notice-close wa-icon {
    font-size: 18px;
    display: block;
  }
`;
