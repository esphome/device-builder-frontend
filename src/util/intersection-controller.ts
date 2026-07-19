import type { ReactiveController, ReactiveControllerHost } from "lit";

export interface IntersectionControllerOptions {
  /** Selector for the scroll container to use as the observer root; omit to
   *  observe against the viewport. */
  rootSelector?: string;
  rootMargin?: string;
}

/**
 * Reactive controller wrapping an ``IntersectionObserver`` over a single
 * ``.sentinel`` element (what ``renderLoadMoreFooter`` emits).
 *
 * Discovers the sentinel (and optional root) in the host's render root after
 * every update, so hosts supply only the ``onIntersect`` callback, which fires
 * each time the sentinel scrolls into view, driving infinite-scroll page
 * fetches. A sentinel that leaves the DOM (no more pages) tears the observer
 * down; a re-rendered one re-subscribes. Torn down on host disconnect.
 */
export class IntersectionController implements ReactiveController {
  private _observer: IntersectionObserver | null = null;
  private _target: Element | null = null;
  private _root: Element | null = null;
  private readonly _rootSelector: string | null;
  private readonly _rootMargin: string;

  constructor(
    private readonly _host: ReactiveControllerHost & { renderRoot: ParentNode },
    private readonly _onIntersect: () => void,
    options: IntersectionControllerOptions = {}
  ) {
    this._rootSelector = options.rootSelector ?? null;
    this._rootMargin = options.rootMargin ?? "200px";
    _host.addController(this);
  }

  hostUpdated(): void {
    const target = this._host.renderRoot.querySelector(".sentinel");
    if (!target) {
      this.disconnect();
      return;
    }
    const root = this._rootSelector
      ? this._host.renderRoot.querySelector(this._rootSelector)
      : null;
    this._observe(target, root);
  }

  hostDisconnected(): void {
    this.disconnect();
  }

  disconnect(): void {
    this._observer?.disconnect();
    this._observer = null;
    this._target = null;
    this._root = null;
  }

  private _observe(target: Element, root: Element | null): void {
    // Re-observe only when the target or root actually changes, so a
    // same-config call from ``hostUpdated`` is a cheap no-op but a
    // re-rendered node rebuilds the observer.
    if (this._observer !== null && this._target === target && this._root === root) {
      return;
    }
    this.disconnect();
    this._target = target;
    this._root = root;
    this._observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) this._onIntersect();
      },
      { root, rootMargin: this._rootMargin }
    );
    this._observer.observe(target);
  }
}
