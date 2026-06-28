import type { ReactiveController, ReactiveControllerHost } from "lit";

export const PAGED_LIST_PAGE_SIZE = 50;

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
  error: unknown = null;

  private _cycle = 0;
  private _offset = 0;
  private _inFlight = false;
  private _fetchPage: PagedFetch<T> | null = null;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _pageSize: number = PAGED_LIST_PAGE_SIZE
  ) {
    _host.addController(this);
  }

  get hasMore(): boolean {
    return this.items.length < this.total;
  }

  hostDisconnected(): void {
    // Drop any in-flight page so a late resolve can't touch a dead host.
    this._cycle++;
    this._inFlight = false;
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
    void this._fetch(false);
  }

  /** Append the next page; no-op while one is in flight or the list is full. */
  loadMore(): void {
    if (this._inFlight || !this.hasMore || this._fetchPage === null) return;
    this.loadingMore = true;
    void this._fetch(true);
  }

  private async _fetch(append: boolean): Promise<void> {
    const fetchPage = this._fetchPage;
    if (fetchPage === null) return;
    const cycle = this._cycle;
    this._inFlight = true;
    try {
      const { items, total } = await fetchPage(this._offset, this._pageSize);
      if (cycle !== this._cycle) return; // superseded by a newer reset()
      this.items = append ? [...this.items, ...items] : items;
      this.total = total;
      this._offset = this.items.length;
      this.error = null;
    } catch (err) {
      if (cycle !== this._cycle) return;
      console.error("Failed to load paged list:", err);
      this.error = err;
    } finally {
      // Only the live cycle clears in-flight / loading state; a stale page
      // resolving after a reset must leave the new cycle's flags untouched.
      if (cycle === this._cycle) {
        this.loading = false;
        this.loadingMore = false;
        this._inFlight = false;
        this._host.requestUpdate();
      }
    }
  }
}
