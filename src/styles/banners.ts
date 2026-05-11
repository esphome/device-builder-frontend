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
