import { afterEach, describe, expect, it, vi } from "vitest";

import type { ESPHomeAPI } from "../../src/api/index.js";
import {
  _clearCatalogCache,
  catalogIndexBinding,
} from "../../src/util/yaml-completion-catalog.js";

const makeApi = (impl?: () => Promise<never>) =>
  ({
    getComponents:
      impl ??
      vi.fn(async () => ({
        components: [{ id: "wifi" }],
        categories: [],
        total: 1,
        offset: 0,
        limit: 1000,
      })),
  }) as unknown as ESPHomeAPI;

describe("catalogIndexBinding", () => {
  afterEach(() => _clearCatalogCache());

  it("caches the index and notifies subscribers on fetch", async () => {
    const listener = vi.fn();
    const unsubscribe = catalogIndexBinding.subscribe(listener);
    expect(catalogIndexBinding.getCached()).toBeUndefined();
    await catalogIndexBinding.fetch(makeApi());
    expect(catalogIndexBinding.getCached()?.byId.has("wifi")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("stays unsettled after a failed load so a retry can land", async () => {
    const failing = makeApi(async () => {
      throw new Error("backend down");
    });
    await catalogIndexBinding.fetch(failing);
    expect(catalogIndexBinding.getCached()).toBeUndefined();
    await catalogIndexBinding.fetch(makeApi());
    expect(catalogIndexBinding.getCached()?.byId.has("wifi")).toBe(true);
  });
});
