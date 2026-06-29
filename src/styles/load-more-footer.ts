import { css } from "lit";

/**
 * Shared styles for the infinite-scroll footer (sentinel + retry) used by the
 * board picker and the component catalog. Pairs with ``renderLoadMoreFooter``
 * in ``components/shared/load-more-footer.ts``; the spinner line uses each
 * host's own ``.loading`` / ``.empty`` class, so only the sentinel and the
 * retry affordance live here.
 */
export const loadMoreFooterStyles = css`
  /* Infinite-scroll trigger: a zero-content marker the IntersectionObserver
     watches; given a sliver of height so it reliably crosses the root. */
  .sentinel {
    height: 1px;
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
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    font-weight: var(--wa-font-weight-bold);
    color: var(--esphome-primary);
    cursor: pointer;
    text-decoration: underline;
  }

  .retry-link:hover {
    text-decoration: none;
  }

  .retry-link:focus-visible {
    outline: 2px solid var(--esphome-primary);
    outline-offset: 2px;
  }
`;
