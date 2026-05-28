import type { ESPHomeAPI } from "../api/index.js";

/** Generic microtask-batched cache with context bucketing.
 *  Shared by ``component-name-cache.ts`` (bucketed on
 *  ``(platform, boardId)``) and ``automation-body-cache.ts``
 *  (single bucket). ``null`` is cached for catalog misses;
 *  transport errors are not. */

interface _PendingResolver<V> {
  resolve: (value: V | null) => void;
  reject: (reason: unknown) => void;
}

interface _Bucket<V, Ctx> {
  api: ESPHomeAPI;
  ctx: Ctx;
  pending: Map<string, _PendingResolver<V>>;
}

export interface BatchedCacheOptions<V, Ctx> {
  name: string;
  /** Same string = same fetcher round trip. */
  bucketKey: (ctx: Ctx) => string;
  fetch: (api: ESPHomeAPI, keys: string[], ctx: Ctx) => Promise<Record<string, V>>;
  /** Cache ``null`` for keys absent from the fetcher response.
   *  Default ``true`` — right for an immutable catalog where a
   *  miss is permanent. Set ``false`` when a missing key is a
   *  server contract violation (the caller advertised the id) so
   *  a re-mount can recover instead of seeing a sticky empty
   *  result. */
  cacheMisses?: boolean;
}

export class BatchedCache<V, Ctx> {
  // Nested by bucket key so neither ``key`` nor the bucket-key
  // string can collide via a delimiter character.
  private _cache = new Map<string, Map<string, V | null>>();
  private _inflight = new Map<string, Map<string, Promise<V | null>>>();
  private _listeners = new Set<() => void>();
  private _batches = new Map<string, _Bucket<V, Ctx>>();
  // Bumped by ``clear()``; ``_flush`` snapshots it before the
  // fetcher await and bails if it advanced during the network
  // hop. Without this, a ``clear()`` overlapping an in-flight
  // post-microtask fetch would neither reject the waiters nor
  // stay cleared (the fetch would resolve, repopulate the cache,
  // and silently outlive the clear).
  private _clearGen = 0;

  constructor(private opts: BatchedCacheOptions<V, Ctx>) {}

  getCached(key: string, ctx: Ctx): V | null | undefined {
    return this._cache.get(this.opts.bucketKey(ctx))?.get(key);
  }

  fetch(api: ESPHomeAPI, key: string, ctx: Ctx): Promise<V | null> {
    const bk = this.opts.bucketKey(ctx);
    const cacheBucket = this._cache.get(bk);
    if (cacheBucket?.has(key)) {
      return Promise.resolve(cacheBucket.get(key) ?? null);
    }
    const inflightBucket = this._inflight.get(bk);
    const existing = inflightBucket?.get(key);
    if (existing) return existing;

    const promise = new Promise<V | null>((resolve, reject) => {
      let bucket = this._batches.get(bk);
      if (bucket === undefined) {
        bucket = { api, ctx, pending: new Map() };
        this._batches.set(bk, bucket);
        queueMicrotask(() => this._flush(bk));
      }
      bucket.pending.set(key, { resolve, reject });
    }).finally(() => {
      this._inflight.get(bk)?.delete(key);
    });

    const inflight = inflightBucket ?? new Map<string, Promise<V | null>>();
    inflight.set(key, promise);
    if (!inflightBucket) this._inflight.set(bk, inflight);
    return promise;
  }

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  clear(): void {
    this._clearGen++;
    for (const bucket of this._inflight.values()) {
      for (const promise of bucket.values()) promise.catch(() => {});
    }
    for (const bucket of this._batches.values()) {
      for (const resolver of bucket.pending.values()) {
        resolver.reject(new Error(`${this.opts.name} cleared`));
      }
    }
    this._cache.clear();
    this._inflight.clear();
    this._listeners.clear();
    this._batches.clear();
  }

  private async _flush(bucketKey: string): Promise<void> {
    const bucket = this._batches.get(bucketKey);
    if (bucket === undefined) return;
    this._batches.delete(bucketKey);
    const gen = this._clearGen;
    const keys = Array.from(bucket.pending.keys());
    let entries: Record<string, V>;
    try {
      entries = await this.opts.fetch(bucket.api, keys, bucket.ctx);
    } catch (err) {
      for (const resolver of bucket.pending.values()) resolver.reject(err);
      return;
    }
    if (gen !== this._clearGen) {
      // ``clear()`` ran during the fetch. Reject the waiters (the
      // bucket was already removed from ``_batches`` before
      // ``clear`` ran, so it never saw them) and don't write the
      // result into the freshly-cleared cache.
      for (const resolver of bucket.pending.values()) {
        resolver.reject(new Error(`${this.opts.name} cleared`));
      }
      return;
    }
    let cacheBucket = this._cache.get(bucketKey);
    if (cacheBucket === undefined) {
      cacheBucket = new Map();
      this._cache.set(bucketKey, cacheBucket);
    }
    const cacheMisses = this.opts.cacheMisses ?? true;
    for (const [key, resolver] of bucket.pending) {
      // Own-property check: the wire payload is a plain object so a
      // bare lookup would resolve ``toString`` / ``constructor`` via
      // the prototype chain and cache that garbage as a hit.
      const present = Object.prototype.hasOwnProperty.call(entries, key);
      const value = present ? entries[key] : null;
      // Cache write before resolve so a sync listener re-calling
      // ``fetch`` for the same key hits the cache path.
      if (present || cacheMisses) cacheBucket.set(key, value);
      resolver.resolve(value);
    }
    this._notify();
  }

  private _notify(): void {
    for (const listener of this._listeners) {
      try {
        listener();
      } catch (err) {
        console.error(`${this.opts.name} listener threw`, err);
      }
    }
  }
}
