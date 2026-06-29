import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Reactive controller wrapping an ``IntersectionObserver`` over a single
 * sentinel element.

 * The host calls ``observe(target, root)`` once the sentinel and its scroll
 * container are in the DOM (e.g. from ``updated``); ``onIntersect`` fires each
 * time the sentinel scrolls into view, driving infinite-scroll page fetches.
 * Re-observing the same target is a no-op; a new target replaces the old
 * subscription. The observer is torn down on host disconnect.
 */
export class IntersectionController implements ReactiveController {
  private _observer: IntersectionObserver | null = null;
  private _target: Element | null = null;
  private _root: Element | null = null;
  private _rootMargin = "";

  constructor(
    host: ReactiveControllerHost,
    private readonly _onIntersect: () => void
  ) {
    host.addController(this);
  }

  /** Observe ``target`` when present, else tear down. ``root`` may be null
   *  (the viewport). Hosts call this from ``updated`` with their (possibly
   *  missing) sentinel. */
  observeIfPresent(
    target: Element | null | undefined,
    root: Element | null,
    rootMargin?: string
  ): void {
    if (target) this.observe(target, root, rootMargin);
    else this.disconnect();
  }

  observe(target: Element, root: Element | null, rootMargin = "0px"): void {
    // Re-observe only when the target or an observer option actually changes,
    // so a same-config call from ``updated`` is a cheap no-op but a new
    // ``root`` / ``rootMargin`` rebuilds the observer.
    if (
      this._observer !== null &&
      this._target === target &&
      this._root === root &&
      this._rootMargin === rootMargin
    ) {
      return;
    }
    this.disconnect();
    this._target = target;
    this._root = root;
    this._rootMargin = rootMargin;
    this._observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) this._onIntersect();
      },
      { root, rootMargin }
    );
    this._observer.observe(target);
  }

  hostDisconnected(): void {
    this.disconnect();
  }

  disconnect(): void {
    this._observer?.disconnect();
    this._observer = null;
    this._target = null;
    this._root = null;
    this._rootMargin = "";
  }
}
