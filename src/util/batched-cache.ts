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
}

export class BatchedCache<V, Ctx> {
  private _cache = new Map<string, V | null>();
  private _inflight = new Map<string, Promise<V | null>>();
  private _listeners = new Set<() => void>();
  private _batches = new Map<string, _Bucket<V, Ctx>>();

  constructor(private opts: BatchedCacheOptions<V, Ctx>) {}

  getCached(key: string, ctx: Ctx): V | null | undefined {
    return this._cache.get(this._cacheKey(key, ctx));
  }

  fetch(api: ESPHomeAPI, key: string, ctx: Ctx): Promise<V | null> {
    const cacheKey = this._cacheKey(key, ctx);
    if (this._cache.has(cacheKey)) {
      return Promise.resolve(this._cache.get(cacheKey) ?? null);
    }
    const existing = this._inflight.get(cacheKey);
    if (existing) return existing;

    const promise = new Promise<V | null>((resolve, reject) => {
      const bk = this.opts.bucketKey(ctx);
      let bucket = this._batches.get(bk);
      if (bucket === undefined) {
        bucket = { api, ctx, pending: new Map() };
        this._batches.set(bk, bucket);
        queueMicrotask(() => this._flush(bk));
      }
      bucket.pending.set(key, { resolve, reject });
    }).finally(() => {
      this._inflight.delete(cacheKey);
    });

    this._inflight.set(cacheKey, promise);
    return promise;
  }

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  clear(): void {
    for (const promise of this._inflight.values()) promise.catch(() => {});
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
    const keys = Array.from(bucket.pending.keys());
    let entries: Record<string, V>;
    try {
      entries = await this.opts.fetch(bucket.api, keys, bucket.ctx);
    } catch (err) {
      for (const resolver of bucket.pending.values()) resolver.reject(err);
      return;
    }
    for (const [key, resolver] of bucket.pending) {
      // Own-property check: the wire payload is a plain object so a
      // bare lookup would resolve ``toString`` / ``constructor`` via
      // the prototype chain and cache that garbage as a hit.
      const value = Object.prototype.hasOwnProperty.call(entries, key)
        ? entries[key]
        : null;
      // Cache write before resolve so a sync listener re-calling
      // ``fetch`` for the same key hits the cache path.
      this._cache.set(this._cacheKey(key, bucket.ctx), value);
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

  private _cacheKey(key: string, ctx: Ctx): string {
    return `${key}|${this.opts.bucketKey(ctx)}`;
  }
}
