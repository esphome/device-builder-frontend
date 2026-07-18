import { type TemplateResult, html, nothing } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";

export interface LoadMoreFooterOptions {
  /** A page append is in flight. */
  loadingMore: boolean;
  /** The last append failed with results already shown. The caller gates this
   *  (e.g. ``error !== null && items.length > 0``) so it's only true when a
   *  retry, not a first-page error, is the right affordance. */
  error: boolean;
  /** More pages remain to fetch. */
  hasMore: boolean;
  localize: LocalizeFunc;
  loadingLabelKey: string;
  errorLabelKey: string;
  /** Re-runs the failed page fetch. */
  onRetry: () => void;
  /** Class for the spinner line; defaults to the shared centered-quiet
   *  ``load-more-loading`` in ``loadMoreFooterStyles``. */
  loadingClass?: string;
}

/**
 * Footer below an infinite-scroll grid: a spinner while a page loads, a retry
 * affordance if the last append failed, else the IntersectionObserver
 * sentinel. The retry renders *instead of* the sentinel so the observer tears
 * down and can't silently re-fire; a successful retry clears the error and the
 * sentinel returns. Pure render helper, no element side-effect imports.
 */
export function renderLoadMoreFooter(
  o: LoadMoreFooterOptions
): TemplateResult | typeof nothing {
  if (o.loadingMore) {
    const cls = o.loadingClass ?? "load-more-loading";
    return html`<p class=${cls}>${o.localize(o.loadingLabelKey)}</p>`;
  }
  if (o.error) {
    return html`<div class="load-more-error" role="alert">
      <span>${o.localize(o.errorLabelKey)}</span>
      <button class="retry-link link-button" type="button" @click=${o.onRetry}>
        ${o.localize("command.retry")}
      </button>
    </div>`;
  }
  return o.hasMore ? html`<div class="sentinel"></div>` : nothing;
}
