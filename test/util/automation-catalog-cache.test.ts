import { afterEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
  Filter,
  LightEffect,
} from "../../src/api/types/automations.js";
import type { ConfigEntry } from "../../src/api/types/config-entries.js";
import { _clearAutomationBodyCache } from "../../src/util/automation-body-cache.js";
import {
  _clearAutomationCatalogCache,
  fetchAutomationActions,
  fetchAutomationConditions,
  fetchAutomationTriggers,
  fetchFilters,
  fetchLightEffects,
  getCachedAutomationActions,
  getCachedAutomationConditions,
  getCachedAutomationTriggers,
  getCachedFilters,
  getCachedLightEffects,
  subscribeAutomationCatalogCache,
} from "../../src/util/automation-catalog-cache.js";

const trigger = (id: string): AutomationTrigger => ({
  id,
  name: id,
  description: "",
  docs_url: "",
  applies_to: [],
  is_device_level: true,
  repeatable: false,
  config_entries: [],
});

const action = (id: string): AutomationAction => ({
  id,
  name: id,
  description: "",
  docs_url: "",
  domain: "core",
  config_entries: [],
  is_control_flow: false,
  has_else_branch: false,
  accepts_action_list: [],
});

const condition = (id: string): AutomationCondition => ({
  id,
  name: id,
  description: "",
  docs_url: "",
  domain: "core",
  config_entries: [],
  accepts_condition_list: false,
});

const effect = (id: string): LightEffect => ({
  id,
  name: id,
  config_entries: [],
  applies_to: [],
});

type Stubbed = {
  api: ESPHomeAPI;
  getAutomationTriggers: ReturnType<typeof vi.fn>;
  getAutomationActions: ReturnType<typeof vi.fn>;
  getAutomationConditions: ReturnType<typeof vi.fn>;
  getLightEffects: ReturnType<typeof vi.fn>;
};

const stubApi = (impls?: {
  triggers?: (
    platform?: string,
    boardId?: string
  ) => Promise<AutomationTrigger[]> | AutomationTrigger[];
  actions?: (
    platform?: string,
    boardId?: string
  ) => Promise<AutomationAction[]> | AutomationAction[];
  conditions?: (
    platform?: string,
    boardId?: string
  ) => Promise<AutomationCondition[]> | AutomationCondition[];
  effects?: (
    platform?: string,
    boardId?: string
  ) => Promise<LightEffect[]> | LightEffect[];
}): Stubbed => {
  const getAutomationTriggers = vi.fn((platform?: string, boardId?: string) =>
    Promise.resolve(impls?.triggers?.(platform, boardId) ?? [trigger("on_boot")])
  );
  const getAutomationActions = vi.fn((platform?: string, boardId?: string) =>
    Promise.resolve(impls?.actions?.(platform, boardId) ?? [action("delay")])
  );
  const getAutomationConditions = vi.fn((platform?: string, boardId?: string) =>
    Promise.resolve(impls?.conditions?.(platform, boardId) ?? [condition("and")])
  );
  const getLightEffects = vi.fn((platform?: string, boardId?: string) =>
    Promise.resolve(impls?.effects?.(platform, boardId) ?? [effect("pulse")])
  );
  const getAutomationBodies = vi.fn(() => Promise.resolve({}));
  return {
    api: {
      getAutomationTriggers,
      getAutomationActions,
      getAutomationConditions,
      getLightEffects,
      getAutomationBodies,
    } as unknown as ESPHomeAPI,
    getAutomationTriggers,
    getAutomationActions,
    getAutomationConditions,
    getLightEffects,
  };
};

describe("automation-catalog-cache", () => {
  afterEach(() => {
    _clearAutomationCatalogCache();
    _clearAutomationBodyCache();
  });

  it("fetches each catalogue on first call and caches the result", async () => {
    const { api, getAutomationTriggers } = stubApi();

    expect(getCachedAutomationTriggers()).toBeUndefined();
    const got = await fetchAutomationTriggers(api);

    expect(got.map((t) => t.id)).toEqual(["on_boot"]);
    expect(getAutomationTriggers).toHaveBeenCalledTimes(1);
    expect(getCachedAutomationTriggers()?.map((t) => t.id)).toEqual(["on_boot"]);

    await fetchAutomationTriggers(api);
    expect(getAutomationTriggers).toHaveBeenCalledTimes(1);
  });

  it("caches each catalogue independently", async () => {
    // The four catalogues live in separate slots; fetching one
    // must not satisfy a fetch of another. Belt-and-braces test
    // because the cache shares plumbing under the hood.
    const { api, getAutomationActions, getAutomationConditions, getLightEffects } =
      stubApi();

    await fetchAutomationActions(api);
    await fetchAutomationConditions(api);
    await fetchLightEffects(api);

    expect(getAutomationActions).toHaveBeenCalledTimes(1);
    expect(getAutomationConditions).toHaveBeenCalledTimes(1);
    expect(getLightEffects).toHaveBeenCalledTimes(1);

    expect(getCachedAutomationActions()?.map((a) => a.id)).toEqual(["delay"]);
    expect(getCachedAutomationConditions()?.map((c) => c.id)).toEqual(["and"]);
    expect(getCachedLightEffects()?.map((e) => e.id)).toEqual(["pulse"]);
  });

  it("dedupes concurrent in-flight calls for the same key", async () => {
    let resolve!: (v: AutomationTrigger[]) => void;
    const { api, getAutomationTriggers } = stubApi({
      triggers: () => new Promise<AutomationTrigger[]>((r) => (resolve = r)),
    });

    const a = fetchAutomationTriggers(api, "esp32");
    const b = fetchAutomationTriggers(api, "esp32");
    const c = fetchAutomationTriggers(api, "esp32");

    expect(getAutomationTriggers).toHaveBeenCalledTimes(1);
    resolve([trigger("on_loop")]);

    await expect(a).resolves.toEqual([trigger("on_loop")]);
    await expect(b).resolves.toEqual([trigger("on_loop")]);
    await expect(c).resolves.toEqual([trigger("on_loop")]);
    expect(getAutomationTriggers).toHaveBeenCalledTimes(1);
  });

  it("keys cache entries by platform and board id", async () => {
    // ``cv.SplitDefault`` defaults on trigger params resolve to
    // different concrete defaults per platform — so the same
    // catalogue filtered for ``esp32`` and ``esp8266`` is two
    // distinct values that must not share a cache slot.
    const { api, getAutomationTriggers } = stubApi({
      triggers: (platform) => [trigger(`on_boot|${platform ?? ""}`)],
    });

    await fetchAutomationTriggers(api, "esp32");
    await fetchAutomationTriggers(api, "esp8266");
    await fetchAutomationTriggers(api);

    expect(getAutomationTriggers).toHaveBeenCalledTimes(3);
    expect(getCachedAutomationTriggers("esp32")?.[0].id).toBe("on_boot|esp32");
    expect(getCachedAutomationTriggers("esp8266")?.[0].id).toBe("on_boot|esp8266");
    expect(getCachedAutomationTriggers()?.[0].id).toBe("on_boot|");
  });

  it("does not cache transport errors so the next call retries", async () => {
    let attempts = 0;
    const { api } = stubApi({
      triggers: () => {
        attempts++;
        if (attempts === 1) return Promise.reject(new Error("network down"));
        return [trigger("on_boot")];
      },
    });

    await expect(fetchAutomationTriggers(api)).rejects.toThrow("network down");
    expect(getCachedAutomationTriggers()).toBeUndefined();

    const second = await fetchAutomationTriggers(api);
    expect(second.map((t) => t.id)).toEqual(["on_boot"]);
  });

  it("isolates listener exceptions from the fetch promise and other listeners", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const goodA = vi.fn();
    const goodB = vi.fn();
    const bad = vi.fn(() => {
      throw new Error("subscriber blew up");
    });
    subscribeAutomationCatalogCache(goodA);
    subscribeAutomationCatalogCache(bad);
    subscribeAutomationCatalogCache(goodB);

    const { api } = stubApi();
    const result = await fetchAutomationTriggers(api);

    expect(result.map((t) => t.id)).toEqual(["on_boot"]);
    expect(goodA).toHaveBeenCalledTimes(1);
    expect(goodB).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("notifies subscribers exactly once per fresh entry across any of the four catalogues", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAutomationCatalogCache(listener);

    const { api } = stubApi();
    await fetchAutomationTriggers(api);
    await fetchAutomationActions(api);

    expect(listener).toHaveBeenCalledTimes(2);

    // Cached reads don't notify again.
    await fetchAutomationTriggers(api);
    await fetchAutomationActions(api);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await fetchAutomationConditions(api);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("_clearAutomationCatalogCache drops every kind, filters included", async () => {
    // Regression: the clear helper hard-coded the four pre-filters
    // kinds and skipped the filters cache, so filter entries (and
    // in-flight filter promises) leaked across tests that relied on
    // it for isolation.
    const filter: Filter = {
      id: "delta",
      name: "Delta",
      config_entries: [],
      applies_to: [],
    };
    const getFilters = vi.fn(() => Promise.resolve([filter]));
    const getAutomationBodies = vi.fn(() => Promise.resolve({}));
    const api = { getFilters, getAutomationBodies } as unknown as ESPHomeAPI;

    await fetchFilters(api);
    expect(getCachedFilters()?.map((f) => f.id)).toEqual(["delta"]);

    _clearAutomationCatalogCache();
    expect(getCachedFilters()).toBeUndefined();

    // A fresh fetch after clear must hit the API again, proving the
    // in-flight slot was also cleared.
    await fetchFilters(api);
    expect(getFilters).toHaveBeenCalledTimes(2);
  });

  it("hydrates config_entries on fetchLightEffects via the body cache", async () => {
    // After backend #1016, the list endpoint ships slim shapes
    // (no config_entries); fetchLightEffects must hydrate via
    // automations/get_bodies before the entry lands in the cache,
    // because registry-list.ts reads config_entries off it.
    const getLightEffects = vi.fn(() =>
      Promise.resolve([
        { id: "pulse", name: "Pulse", config_entries: [], applies_to: [] } as LightEffect,
      ])
    );
    const getAutomationBodies = vi.fn(() =>
      Promise.resolve({
        "light_effects/pulse": {
          id: "pulse",
          name: "Pulse",
          config_entries: [{ key: "transition_length" }],
          applies_to: [],
        } as unknown as LightEffect,
      })
    );
    const api = { getLightEffects, getAutomationBodies } as unknown as ESPHomeAPI;

    const list = await fetchLightEffects(api);

    expect(list[0].config_entries).toEqual([{ key: "transition_length" }]);
    expect(getAutomationBodies).toHaveBeenCalledTimes(1);
    expect(getAutomationBodies).toHaveBeenCalledWith([
      { type: "light_effects", id: "pulse" },
    ]);
  });

  it("retries hydration on a cached list when the previous attempt failed", async () => {
    // Pre-merge bug: the list cache pinned a partially-hydrated
    // list so a one-off body-fetch failure stayed empty for the
    // session. Per-entry WeakSet flag now lets the next call's
    // post-fetch hydration pick up only the still-empty entries.
    const getLightEffects = vi.fn(() =>
      Promise.resolve([
        { id: "pulse", name: "Pulse", config_entries: [], applies_to: [] } as LightEffect,
      ])
    );
    let attempts = 0;
    const getAutomationBodies = vi.fn(() => {
      attempts++;
      const out: Record<string, LightEffect> =
        attempts === 1
          ? {} // contract violation: list advertised "pulse" but get_bodies returns nothing.
          : {
              "light_effects/pulse": {
                id: "pulse",
                name: "Pulse",
                config_entries: [{ key: "transition_length" }],
                applies_to: [],
              } as unknown as LightEffect,
            };
      return Promise.resolve(out);
    });
    const api = { getLightEffects, getAutomationBodies } as unknown as ESPHomeAPI;

    const first = await fetchLightEffects(api);
    expect(first[0].config_entries).toEqual([]); // still slim after failure

    const second = await fetchLightEffects(api);
    // Same entry mutated in place — the entry object identity is
    // preserved across calls. The wrapping array identity differs
    // after the post-hydration swap (so identity-checking
    // subscribers re-render), but the underlying entry object
    // received its ``config_entries`` from the second body fetch.
    expect(second[0]).toBe(first[0]);
    expect(second[0].config_entries).toEqual([{ key: "transition_length" }]);
    expect(getLightEffects).toHaveBeenCalledTimes(1); // list cache hit
    expect(getAutomationBodies).toHaveBeenCalledTimes(2); // two body fetches (first failed, second recovered)
  });

  it("skips body fetches on a fully-hydrated cache hit", async () => {
    const getLightEffects = vi.fn(() =>
      Promise.resolve([
        { id: "pulse", name: "Pulse", config_entries: [], applies_to: [] } as LightEffect,
      ])
    );
    const getAutomationBodies = vi.fn(() =>
      Promise.resolve({
        "light_effects/pulse": {
          id: "pulse",
          name: "Pulse",
          config_entries: [{ key: "transition_length" }],
          applies_to: [],
        } as unknown as LightEffect,
      })
    );
    const api = { getLightEffects, getAutomationBodies } as unknown as ESPHomeAPI;

    await fetchLightEffects(api);
    await fetchLightEffects(api);
    await fetchLightEffects(api);

    // First call fetched both list and body; second + third
    // short-circuit both: list cache hit + WeakSet says hydrated.
    expect(getLightEffects).toHaveBeenCalledTimes(1);
    expect(getAutomationBodies).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers with a fresh array reference after hydration", async () => {
    // Without this, the slim list lands in the cache and ``_notify``
    // fires; subscribers re-read ``cache()`` and store the slim
    // array. Then hydration mutates ``config_entries`` in place but
    // never re-notifies, so registry-list keeps showing empty forms
    // because Lit's identity-based ``hasChanged`` says nothing
    // changed on the array prop.
    const slimEntry = {
      id: "pulse",
      name: "Pulse",
      config_entries: [] as ConfigEntry[],
      applies_to: [] as string[],
    } as LightEffect;
    const getLightEffects = vi.fn(() => Promise.resolve([slimEntry]));
    const getAutomationBodies = vi.fn(() =>
      Promise.resolve({
        "light_effects/pulse": {
          id: "pulse",
          name: "Pulse",
          config_entries: [{ key: "transition_length" }],
          applies_to: [],
        } as unknown as LightEffect,
      })
    );
    const api = { getLightEffects, getAutomationBodies } as unknown as ESPHomeAPI;

    const notifications: (LightEffect[] | undefined)[] = [];
    const unsub = subscribeAutomationCatalogCache(() => {
      notifications.push(getCachedLightEffects());
    });

    const returned = await fetchLightEffects(api);

    // Two notifications: one when slim lands inside ``_fetch``, one
    // after hydration replaces the cached array.
    expect(notifications.length).toBe(2);
    const slim = notifications[0]!;
    const hydrated = notifications[1]!;
    // Distinct array identity so Lit's hasChanged trips.
    expect(hydrated).not.toBe(slim);
    // Hydrated entries carry the populated ``config_entries``.
    expect(hydrated[0].config_entries).toEqual([{ key: "transition_length" }]);
    // The returned list matches what's now in the cache.
    expect(returned).toBe(hydrated);
    expect(returned).toBe(getCachedLightEffects());
    unsub();
  });

  it("does not double-notify when hydration is a no-op (all entries already hydrated)", async () => {
    const slimEntry = {
      id: "pulse",
      name: "Pulse",
      config_entries: [] as ConfigEntry[],
      applies_to: [] as string[],
    } as LightEffect;
    const getLightEffects = vi.fn(() => Promise.resolve([slimEntry]));
    const getAutomationBodies = vi.fn(() =>
      Promise.resolve({
        "light_effects/pulse": {
          id: "pulse",
          name: "Pulse",
          config_entries: [{ key: "transition_length" }],
          applies_to: [],
        } as unknown as LightEffect,
      })
    );
    const api = { getLightEffects, getAutomationBodies } as unknown as ESPHomeAPI;

    await fetchLightEffects(api); // first call: slim + hydrate-notify

    let extraNotifications = 0;
    const unsub = subscribeAutomationCatalogCache(() => {
      extraNotifications++;
    });

    await fetchLightEffects(api); // second call: cache hit, hydration no-op

    expect(extraNotifications).toBe(0);
    unsub();
  });

  it("hydrates config_entries on fetchFilters via the body cache", async () => {
    const getFilters = vi.fn(() =>
      Promise.resolve([
        { id: "delta", name: "Delta", config_entries: [], applies_to: [] } as Filter,
      ])
    );
    const getAutomationBodies = vi.fn(() =>
      Promise.resolve({
        "filters/delta": {
          id: "delta",
          name: "Delta",
          config_entries: [{ key: "min_change" }],
          applies_to: [],
        } as unknown as Filter,
      })
    );
    const api = { getFilters, getAutomationBodies } as unknown as ESPHomeAPI;

    const list = await fetchFilters(api);

    expect(list[0].config_entries).toEqual([{ key: "min_change" }]);
    expect(getAutomationBodies).toHaveBeenCalledTimes(1);
  });
});
