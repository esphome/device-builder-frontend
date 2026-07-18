import { css } from "lit";

import { linkButtonStyles } from "./link-button.js";

/**
 * Shared styles for the infinite-scroll footer (sentinel + spinner + retry).
 * Pairs with ``renderLoadMoreFooter`` in ``components/shared/load-more-footer.ts``;
 * the spinner line defaults to ``.load-more-loading``, overridable per host
 * via ``loadingClass``. Bundles ``linkButtonStyles`` for the retry link
 * (Lit flattens the nested array in ``static styles``).
 */
export const loadMoreFooterStyles = [
  linkButtonStyles,
  css`
    /* Infinite-scroll trigger: a zero-content marker the IntersectionObserver
     watches; given a sliver of height so it reliably crosses the root. */
    .sentinel {
      height: 1px;
    }

    .load-more-loading {
      text-align: center;
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
      padding: var(--wa-space-xl);
    }

    .load-more-error {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--wa-space-xs);
      padding: var(--wa-space-m);
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
    }

    .retry-link {
      font-weight: var(--wa-font-weight-bold);
    }

    .retry-link:hover {
      text-decoration: none;
    }

    .retry-link:focus-visible {
      outline: var(--esphome-focus-outline);
      outline-offset: 2px;
    }
  `,
];
