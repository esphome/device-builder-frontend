import type { ReactiveController, ReactiveControllerHost } from "lit";

const DEFAULT_PAGE_SIZE = 50;

export type PagedFetch<T> = (
  offset: number,
  limit: number
) => Promise<{ items: T[]; total: number }>;

/**
 * Reactive controller that accumulates a server-paged list.

 * The host calls ``reset(fetchPage)`` whenever the query changes (search,
 * filter) and ``loadMore()`` as the user scrolls toward the bottom; pages
 * append onto ``items``. A monotonic cycle counter discards a page whose
 * ``reset`` was superseded mid-flight, so a search keystroke landing during
 * a scroll-fetch can't graft stale rows onto the new query.
 */
export class PagedListController<T> implements ReactiveController {
  items: T[] = [];
  total = 0;
  /** First page of a ``reset`` in flight. */
  loading = false;
  /** A ``loadMore`` page in flight. */
  loadingMore = false;
  /** True once the first ``reset`` has resolved (success or error); lets the
   *  host show a first-paint loader without tracking its own flag. */
  hasLoaded = false;
  error: unknown = null;

  private _cycle = 0;
  private _offset = 0;
  private _fetchPage: PagedFetch<T> | null = null;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _pageSize: number = DEFAULT_PAGE_SIZE
  ) {
    _host.addController(this);
  }

  get hasMore(): boolean {
    return this.items.length < this.total;
  }

  /** Whether the last fetch failed; ``error`` is typed ``unknown`` and may be
   *  a falsy value, so consumers should test this rather than ``error``. */
  get hasError(): boolean {
    return this.error !== null;
  }

  hostDisconnected(): void {
    // Drop any in-flight page so a late resolve can't touch a dead host; the
    // bumped cycle stops the pending fetch's ``finally`` from clearing the
    // flags itself, so clear them here.
    this._cycle++;
    this.loading = false;
    this.loadingMore = false;
  }

  /** Start a fresh query: drop the accumulated list and fetch page 0. */
  reset(fetchPage: PagedFetch<T>): void {
    this._cycle++;
    this._fetchPage = fetchPage;
    this._offset = 0;
    this.items = [];
    this.total = 0;
    this.error = null;
    this.loading = true;
    this.loadingMore = false;
    // Paint the loading state now; a reset off a debounced search isn't a
    // reactive property change, so nothing else would request a render.
    this._host.requestUpdate();
    void this._fetch();
  }

  /** Append the next page; no-op while one is in flight or the list is full. */
  loadMore(): void {
    if (this.loading || this.loadingMore || !this.hasMore || this._fetchPage === null) {
      return;
    }
    this.loadingMore = true;
    // The IntersectionObserver sentinel drives this with no reactive change,
    // so request a render to surface the loading-more state.
    this._host.requestUpdate();
    void this._fetch();
  }

  private async _fetch(): Promise<void> {
    const fetchPage = this._fetchPage;
    if (fetchPage === null) return;
    const cycle = this._cycle;
    try {
      const { items, total } = await fetchPage(this._offset, this._pageSize);
      if (cycle !== this._cycle) return; // superseded by a newer reset()
      // reset() clears items first, so the spread also covers the first page.
      this.items = [...this.items, ...items];
      this.total = total;
      this._offset = this.items.length;
      this.error = null;
    } catch (err) {
      if (cycle !== this._cycle) return;
      console.error("Failed to load paged list:", err);
      this.error = err;
    } finally {
      // Only the live cycle clears state; a stale page resolving after a reset
      // must leave the new cycle's flags untouched.
      if (cycle === this._cycle) {
        this.loading = false;
        this.loadingMore = false;
        this.hasLoaded = true;
        this._host.requestUpdate();
      }
    }
  }
}
