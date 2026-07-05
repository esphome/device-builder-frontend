/**
 * Keyed promise memoisation: a ``Map<string, Promise<T>>`` where
 * concurrent callers for the same key share one in-flight promise and,
 * by default, a rejected promise is evicted so the next call retries
 * instead of replaying the failure forever. Shared by
 * ``provides-cache.ts`` and the schema readers
 * (``esphome-schema.ts`` / ``esphome-schema-core.ts``).
 *
 * This is the third shape in the shared-cache family:
 * :func:`createSessionBlobCache` (`session-blob-cache.ts`) adds
 * subscriber notification and a sync ``getCached`` read for whole
 * immutable payloads, and :class:`BatchedCache` (`batched-cache.ts`)
 * microtask-batches many keys into one fetcher round trip. This class
 * is the minimal core both idioms start from — per-key dedupe with a
 * retry-on-failure policy — for callers that only ever await the
 * promise.
 *
 * Not a fit for ``fetchBundle``'s bundle cache, which re-keys entries
 * mid-flight (bare name → ``<version>/<name>``) and evicts on a
 * *resolved* transient-``null``, not on rejection.
 */
export interface KeyedPromiseCacheOptions {
  /** Evict a rejected promise so the next call retries. Default
   *  ``true`` — the point of the idiom. Set ``false`` to memoise
   *  rejections too (a replayed rejection is then permanent for the
   *  cache's lifetime). */
  evictOnReject?: boolean;
}

export class KeyedPromiseCache<T> {
  private readonly _cache = new Map<string, Promise<T>>();
  private readonly _evictOnReject: boolean;

  constructor(opts: KeyedPromiseCacheOptions = {}) {
    this._evictOnReject = opts.evictOnReject ?? true;
  }

  /**
   * Return the memoised promise for *key*, calling *create* only when
   * no entry exists. *create* runs synchronously on a miss (callers
   * rely on the underlying request firing right away); a synchronous
   * throw propagates and caches nothing.
   */
  fetch(key: string, create: () => Promise<T>): Promise<T> {
    const cached = this._cache.get(key);
    if (cached) return cached;
    let promise: Promise<T>;
    if (this._evictOnReject) {
      // Store and return the rethrowing ``.catch`` chain, not the
      // original promise with a side-listener. A side-listener would
      // mark the rejection handled and silence ``unhandledRejection``
      // diagnostics for callers that drop the returned promise; the
      // chain rethrows, so an ignored rejection still surfaces (the
      // behaviour of the hand-rolled caches this replaces). The
      // identity guard keeps a stale rejection from evicting a fresh
      // entry written after a ``clear()``.
      promise = create().catch((err: unknown) => {
        if (this._cache.get(key) === promise) this._cache.delete(key);
        throw err;
      });
    } else {
      promise = create();
    }
    this._cache.set(key, promise);
    return promise;
  }

  /** Drop every entry, in-flight or settled. */
  clear(): void {
    this._cache.clear();
  }
}
