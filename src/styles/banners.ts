/**
 * Shared banner styles for the dashboard's inline alerts.
 *
 * The warning-banner shape (left-accent stripe + warm background +
 * tonal text) is the project-wide pattern for "non-fatal but worth
 * reading" notices: a phase / preview indicator, a one-time-token
 * reveal warning, etc. Three consumers landed before this got
 * extracted; future consumers should pull this in rather than
 * re-rolling the rules.
 *
 * Composition pattern:
 *
 * ```ts
 * static styles = [
 *   espHomeStyles,
 *   warningBannerStyles,
 *   css`
 *     .warning-banner {
 *       margin: 0 0 var(--wa-space-m);  // per-consumer spacing
 *     }
 *   `,
 * ];
 * ```
 *
 * The banner's padding / radius / font / colour stack is fixed
 * here; per-consumer rules layer on top of the shared shape for
 * outer spacing only. If a consumer needs a meaningfully different
 * layout (e.g. icon + title + description columns, or an inline
 * action button) it's a different banner — keep its rules inline
 * rather than pulling them into this module.
 */
import { css } from "lit";

export const warningBannerStyles = css`
  .warning-banner {
    padding: var(--wa-space-s) var(--wa-space-m);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-warning-fill-quiet, #fff7e0);
    color: var(--wa-color-warning-text-quiet, #6b4f00);
    border-left: 3px solid var(--wa-color-warning-border-loud, #f0b400);
    font-size: var(--wa-font-size-s);
  }
`;

/**
 * Danger-banner shape for backend validation errors: icon + column of
 * bold messages on the danger token stack. Consumers layer positioning
 * (the editor's floating placement) or outer spacing on top.
 */
export const dangerBannerStyles = css`
  .danger-banner {
    display: flex;
    align-items: flex-start;
    gap: var(--wa-space-s);
    padding: var(--wa-space-s) var(--wa-space-m);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-danger-fill-quiet);
    border: var(--wa-border-width-s) solid var(--wa-color-danger-60);
    color: var(--wa-color-danger-text-normal);
  }

  .danger-banner wa-icon {
    flex: 0 0 auto;
    font-size: 1.25rem;
    margin-top: 0.05rem;
    color: var(--wa-color-danger-60);
  }

  .danger-banner-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    line-height: 1.4;
    min-width: 0;
  }

  .danger-banner-text > * {
    margin: 0;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    word-break: break-word;
  }
`;
