import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PagedListController } from "../../src/util/paged-list-controller.js";
import { FakeHost } from "../_fake-host.js";

const flush = () => vi.advanceTimersByTimeAsync(0);

// A fetcher over a fixed dataset that slices by offset/limit.
function datasetFetch(total: number) {
  const all = Array.from({ length: total }, (_, i) => i);
  const fetchPage = vi.fn(async (offset: number, limit: number) => ({
    items: all.slice(offset, offset + limit),
    total,
  }));
  return { all, fetchPage };
}

function make() {
  const host = new FakeHost();
  const ctrl = new PagedListController<number>(host, 50);
  return { host, ctrl };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PagedListController", () => {
  it("reset loads page 0 and reports total / hasMore", async () => {
    const { ctrl } = make();
    const { fetchPage } = datasetFetch(120);

    ctrl.reset(fetchPage);
    expect(ctrl.loading).toBe(true);
    expect(ctrl.hasLoaded).toBe(false);
    await flush();

    expect(fetchPage).toHaveBeenCalledWith(0, 50);
    expect(ctrl.items).toHaveLength(50);
    expect(ctrl.total).toBe(120);
    expect(ctrl.hasMore).toBe(true);
    expect(ctrl.loading).toBe(false);
    expect(ctrl.hasLoaded).toBe(true);
  });

  it("loadMore appends the next page and advances the offset", async () => {
    const { ctrl } = make();
    const { fetchPage } = datasetFetch(120);
    ctrl.reset(fetchPage);
    await flush();

    ctrl.loadMore();
    expect(ctrl.loadingMore).toBe(true);
    await flush();
    expect(fetchPage).toHaveBeenLastCalledWith(50, 50);
    expect(ctrl.items).toHaveLength(100);
    expect(ctrl.items[50]).toBe(50);
    expect(ctrl.hasMore).toBe(true);

    ctrl.loadMore();
    await flush();
    expect(ctrl.items).toHaveLength(120);
    expect(ctrl.hasMore).toBe(false);
  });

  it("requests a host update synchronously on reset and loadMore", async () => {
    const { host, ctrl } = make();
    const { fetchPage } = datasetFetch(120);

    ctrl.reset(fetchPage);
    // Painted immediately, before the fetch resolves, so the loading state
    // shows even when reset comes off a debounced (non-reactive) callback.
    expect(host.updates).toBe(1);
    await flush();
    const afterFirstPage = host.updates;

    ctrl.loadMore();
    expect(host.updates).toBe(afterFirstPage + 1);
    await flush();
  });

  it("loadMore is a no-op when the list is already full", async () => {
    const { ctrl } = make();
    const { fetchPage } = datasetFetch(30);
    ctrl.reset(fetchPage);
    await flush();
    expect(ctrl.hasMore).toBe(false);

    ctrl.loadMore();
    await flush();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("ignores an in-flight first page when a reset supersedes it", async () => {
    const { ctrl } = make();

    let release: (v: { items: number[]; total: number }) => void = () => {};
    const slow = vi.fn(
      () => new Promise<{ items: number[]; total: number }>((r) => (release = r))
    );
    ctrl.reset(slow);

    const { fetchPage: fast } = datasetFetch(10);
    ctrl.reset(fast);
    await flush();
    expect(ctrl.items).toHaveLength(10);
    expect(ctrl.total).toBe(10);

    // The superseded first page resolves late — it must not clobber the list.
    release({ items: [999, 998, 997], total: 999 });
    await flush();
    expect(ctrl.items).toHaveLength(10);
    expect(ctrl.total).toBe(10);
  });

  it("ignores a stale loadMore page when a reset supersedes it", async () => {
    const { ctrl } = make();

    let release: (v: { items: number[]; total: number }) => void = () => {};
    const fetchPage = vi.fn((offset: number) =>
      offset === 0
        ? Promise.resolve({ items: [0, 1, 2], total: 9 })
        : new Promise<{ items: number[]; total: number }>((r) => (release = r))
    );
    ctrl.reset(fetchPage);
    await flush();
    expect(ctrl.items).toEqual([0, 1, 2]);

    ctrl.loadMore();
    expect(ctrl.loadingMore).toBe(true);

    const { fetchPage: fast } = datasetFetch(5);
    ctrl.reset(fast);
    await flush();
    expect(ctrl.items).toEqual([0, 1, 2, 3, 4]);
    expect(ctrl.loadingMore).toBe(false);

    // The stale loadMore resolves; it must not append onto the new query.
    release({ items: [100, 101], total: 9 });
    await flush();
    expect(ctrl.items).toEqual([0, 1, 2, 3, 4]);
  });

  it("exposes a fetch error and stops loading", async () => {
    const { ctrl } = make();
    const boom = new Error("boom");
    ctrl.reset(async () => {
      throw boom;
    });
    await flush();
    expect(ctrl.error).toBe(boom);
    expect(ctrl.loading).toBe(false);
    expect(ctrl.items).toEqual([]);
  });
});
