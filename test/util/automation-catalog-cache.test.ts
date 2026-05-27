import { afterEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
  LightEffect,
} from "../../src/api/types.js";
import {
  _clearAutomationCatalogCache,
  fetchAutomationActions,
  fetchAutomationConditions,
  fetchAutomationTriggers,
  fetchLightEffects,
  getCachedAutomationActions,
  getCachedAutomationConditions,
  getCachedAutomationTriggers,
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
  return {
    api: {
      getAutomationTriggers,
      getAutomationActions,
      getAutomationConditions,
      getLightEffects,
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
});
