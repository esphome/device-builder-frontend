import type { ReactiveController, ReactiveControllerHost } from "lit";

import type { ESPHomeAPI } from "../api/esphome-api.js";

/**
 * The slice of a {@link SessionBlobCache} module a consumer needs to read
 * and prime a single no-arg cache. Bound to the module's *exported wrappers*
 * (e.g. ``getCachedSecretKeys`` / ``subscribeSecretKeys`` / ``fetchSecretKeys``)
 * rather than the raw cache object, so module-level side effects of those
 * wrappers — like secrets-cache tracking the last api for its
 * ``secrets-saved`` refresh — are preserved.
 */
export interface SessionBlobCacheBinding<T> {
  getCached: () => T | undefined;
  subscribe: (cb: () => void) => () => void;
  fetch: (api: ESPHomeAPI) => Promise<T>;
}

/**
 * Reactive controller that wires a no-arg session-blob cache into a Lit
 * host's lifecycle:
 *
 * - subscribes on connect (re-rendering the host when the cached value
 *   changes) and unsubscribes on disconnect,
 * - kicks the shared fetch exactly once, as soon as the host's api lands,
 * - exposes the cached value via {@link value}.
 *
 * Replaces the hand-rolled ``_unsub`` / ``_kicked`` / ``connectedCallback``
 * / ``disconnectedCallback`` / ``updated()`` trio that several cache
 * consumers duplicated. The cache itself owns de-dup, the shared in-flight
 * promise, and the failure fallback; the controller only bridges it to the
 * host's render lifecycle.
 *
 * For a cache whose payload varies by fetch argument, or one that carries
 * per-consumer error / retry state, drive the cache directly — this
 * controller deliberately models only the single-blob, fetch-once shape.
 */
export class SessionBlobCacheController<T> implements ReactiveController {
  private _unsubscribe?: () => void;
  // Set once the fetch has been kicked so hostUpdated() doesn't re-evaluate
  // on every reactive update. Sticky across reconnects — the session cache
  // returns the same resolved value, so a re-kick would be a no-op anyway.
  private _kicked = false;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _binding: SessionBlobCacheBinding<T>,
    private readonly _api: () => ESPHomeAPI | undefined
  ) {
    _host.addController(this);
  }

  hostConnected(): void {
    // The shared cache owns the refresh; we just repaint when it changes.
    this._unsubscribe = this._binding.subscribe(() => this._host.requestUpdate());
  }

  hostDisconnected(): void {
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  hostUpdated(): void {
    // Kick the shared fetch once, when the api context first lands — not on
    // every render. The cache + subscribe handle dedupe and the repaint.
    if (this._kicked) return;
    const api = this._api();
    if (!api) return;
    this._kicked = true;
    void this._binding.fetch(api);
  }

  /** Cached value for this session, or ``undefined`` until the first
   *  fetch resolves. */
  get value(): T | undefined {
    return this._binding.getCached();
  }
}
