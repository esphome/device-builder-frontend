import { afterEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { AutomationCatalogBody } from "../../src/api/types.js";
import {
  _clearAutomationBodyCache,
  fetchAutomationBody,
  getCachedAutomationBody,
  subscribeAutomationBodyCache,
} from "../../src/util/automation-body-cache.js";

const trigger = (id: string, name: string): AutomationCatalogBody =>
  ({
    id,
    name,
    description: "",
    docs_url: "",
    applies_to: [],
    is_device_level: false,
    config_entries: [],
  }) as AutomationCatalogBody;

interface MockApi {
  api: ESPHomeAPI;
  getAutomationBodies: ReturnType<typeof vi.fn>;
}

const mockApi = (
  impl: (type: string, id: string) => AutomationCatalogBody | null,
  overridePromise?: () => Promise<Record<string, AutomationCatalogBody>>
): MockApi => {
  const getAutomationBodies = vi.fn((refs: { type: string; id: string }[]) => {
    if (overridePromise) return overridePromise();
    const result: Record<string, AutomationCatalogBody> = {};
    for (const ref of refs) {
      const body = impl(ref.type, ref.id);
      if (body !== null) result[`${ref.type}/${ref.id}`] = body;
    }
    return Promise.resolve(result);
  });
  return {
    api: { getAutomationBodies } as unknown as ESPHomeAPI,
    getAutomationBodies,
  };
};

describe("automation-body-cache", () => {
  afterEach(() => {
    _clearAutomationBodyCache();
  });

  it("fetches an uncached body and caches the result", async () => {
    const { api, getAutomationBodies } = mockApi(() => trigger("on_boot", "On Boot"));

    expect(getCachedAutomationBody("triggers", "on_boot")).toBeUndefined();
    const got = await fetchAutomationBody(api, "triggers", "on_boot");

    expect(got?.name).toBe("On Boot");
    expect(getAutomationBodies).toHaveBeenCalledTimes(1);
    expect(getCachedAutomationBody("triggers", "on_boot")?.name).toBe("On Boot");

    await fetchAutomationBody(api, "triggers", "on_boot");
    expect(getAutomationBodies).toHaveBeenCalledTimes(1);
  });

  it("coalesces cross-type parallel fetches into one batched call", async () => {
    const { api, getAutomationBodies } = mockApi((type, id) =>
      trigger(`${type}/${id}`, `name:${type}/${id}`)
    );

    const [t, a, c] = await Promise.all([
      fetchAutomationBody(api, "triggers", "on_boot"),
      fetchAutomationBody(api, "actions", "delay"),
      fetchAutomationBody(api, "conditions", "lambda"),
    ]);

    expect(t?.name).toBe("name:triggers/on_boot");
    expect(a?.name).toBe("name:actions/delay");
    expect(c?.name).toBe("name:conditions/lambda");
    expect(getAutomationBodies).toHaveBeenCalledTimes(1);
    expect(getAutomationBodies).toHaveBeenCalledWith([
      { type: "triggers", id: "on_boot" },
      { type: "actions", id: "delay" },
      { type: "conditions", id: "lambda" },
    ]);
  });

  it("dedupes concurrent in-flight calls for the same key", async () => {
    let resolve!: (v: Record<string, AutomationCatalogBody>) => void;
    const { api, getAutomationBodies } = mockApi(
      () => null,
      () => new Promise<Record<string, AutomationCatalogBody>>((r) => (resolve = r))
    );

    const a = fetchAutomationBody(api, "triggers", "on_boot");
    const b = fetchAutomationBody(api, "triggers", "on_boot");
    const c = fetchAutomationBody(api, "triggers", "on_boot");

    await Promise.resolve();
    expect(getAutomationBodies).toHaveBeenCalledTimes(1);

    resolve({ "triggers/on_boot": trigger("on_boot", "On Boot") });
    await expect(a).resolves.toMatchObject({ name: "On Boot" });
    await expect(b).resolves.toMatchObject({ name: "On Boot" });
    await expect(c).resolves.toMatchObject({ name: "On Boot" });
    expect(getAutomationBodies).toHaveBeenCalledTimes(1);
  });

  it("rejects pending waiters when the cache is cleared mid-flight", async () => {
    const { api } = mockApi(
      () => null,
      () => new Promise<Record<string, AutomationCatalogBody>>(() => {})
    );

    const pending = fetchAutomationBody(api, "triggers", "on_boot");
    _clearAutomationBodyCache();

    await expect(pending).rejects.toThrow("automation-body-cache cleared");
  });

  it("does not resolve prototype keys as cache hits", async () => {
    const { api } = mockApi(() => null);

    const result = await fetchAutomationBody(api, "triggers", "toString");
    expect(result).toBeNull();
  });

  it("does not cache misses (advertised ids may recover on retry)", async () => {
    // The list endpoint advertises every (type, id) the editor
    // asks for; a null body is a server contract violation, not a
    // permanent catalog miss. ``cacheMisses: false`` lets a second
    // call re-attempt instead of pinning the null.
    let attempts = 0;
    const { api, getAutomationBodies } = mockApi(
      () => null,
      () => {
        attempts++;
        const out: Record<string, AutomationCatalogBody> =
          attempts === 1
            ? {}
            : { "triggers/recovered": trigger("recovered", "Recovered") };
        return Promise.resolve(out);
      }
    );

    const first = await fetchAutomationBody(api, "triggers", "recovered");
    expect(first).toBeNull();
    expect(getCachedAutomationBody("triggers", "recovered")).toBeUndefined();

    const second = await fetchAutomationBody(api, "triggers", "recovered");
    expect(second?.name).toBe("Recovered");
    expect(getAutomationBodies).toHaveBeenCalledTimes(2);
  });

  it("does not cache transport errors (allows retry)", async () => {
    let attempts = 0;
    const { api } = mockApi(
      () => trigger("on_boot", "On Boot"),
      () => {
        attempts++;
        if (attempts === 1) return Promise.reject(new Error("network down"));
        return Promise.resolve({
          "triggers/on_boot": trigger("on_boot", "On Boot"),
        });
      }
    );

    await expect(fetchAutomationBody(api, "triggers", "on_boot")).rejects.toThrow(
      "network down"
    );
    expect(getCachedAutomationBody("triggers", "on_boot")).toBeUndefined();

    const second = await fetchAutomationBody(api, "triggers", "on_boot");
    expect(second?.name).toBe("On Boot");
  });

  it("notifies subscribers once per flushed batch", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAutomationBodyCache(listener);

    const { api } = mockApi((_t, id) => trigger(id, id));
    await Promise.all([
      fetchAutomationBody(api, "triggers", "on_boot"),
      fetchAutomationBody(api, "actions", "delay"),
    ]);

    expect(listener).toHaveBeenCalledTimes(1);

    await fetchAutomationBody(api, "triggers", "on_boot");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    const { api: api2 } = mockApi(() => trigger("lambda", "lambda"));
    await fetchAutomationBody(api2, "conditions", "lambda");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("isolates listener exceptions from the fetch promise", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const goodA = vi.fn();
    const goodB = vi.fn();
    const bad = vi.fn(() => {
      throw new Error("subscriber blew up");
    });
    subscribeAutomationBodyCache(goodA);
    subscribeAutomationBodyCache(bad);
    subscribeAutomationBodyCache(goodB);

    const { api } = mockApi(() => trigger("on_boot", "On Boot"));
    const result = await fetchAutomationBody(api, "triggers", "on_boot");

    expect(result?.name).toBe("On Boot");
    expect(goodA).toHaveBeenCalledTimes(1);
    expect(goodB).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
