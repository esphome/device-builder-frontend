import { describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../../../src/api/index.js";
import type {
  AutomationAction,
  AutomationCatalogBody,
  AutomationCatalogBodyType,
  AutomationCondition,
  AutomationTrigger,
  AvailableAutomations,
  ConfigEntry,
} from "../../../../src/api/types.js";
import {
  hydrateAvailableBodies,
  loadAndHydrateAvailable,
} from "../../../../src/components/device/automation-editor/hydrate-available-bodies.js";

const configEntry = (key: string): ConfigEntry => ({ key }) as ConfigEntry;

const triggerBody = (id: string, entries: ConfigEntry[]): AutomationCatalogBody =>
  ({
    id,
    name: id,
    description: "",
    docs_url: "",
    applies_to: [],
    is_device_level: false,
    config_entries: entries,
  }) as AutomationCatalogBody;

const slimAvailable = (): AvailableAutomations =>
  ({
    triggers: [
      { id: "good", config_entries: [] as ConfigEntry[] },
      { id: "missing", config_entries: [] as ConfigEntry[] },
      { id: "boom", config_entries: [] as ConfigEntry[] },
    ],
    actions: [],
    conditions: [],
    scripts: [],
    devices: [],
  }) as unknown as AvailableAutomations;

const makeApi = () => ({}) as ESPHomeAPI;

describe("hydrateAvailableBodies", () => {
  it("populates config_entries from the body cache and deep-clones the tree", async () => {
    const sharedEntries = [configEntry("foo"), configEntry("bar")];
    const cachedBody = triggerBody("good", sharedEntries);
    const fetchBody = vi.fn(async (_api, type, id) => {
      if (type === "triggers" && id === "good") return cachedBody;
      return null;
    });
    const available = slimAvailable();
    const goodEntry = available.triggers[0];

    const result = await hydrateAvailableBodies(makeApi(), available, fetchBody);

    expect(goodEntry.config_entries).toEqual(sharedEntries);
    // Array reference is distinct (add/remove/reorder safety).
    expect(goodEntry.config_entries).not.toBe(sharedEntries);
    // Each entry object is also distinct (in-place mutation safety).
    expect(goodEntry.config_entries[0]).not.toBe(sharedEntries[0]);

    // Pin the invariant in code: mutate the hydrated copy and
    // confirm the cached body's entries are untouched.
    (goodEntry.config_entries[0] as unknown as { key: string }).key = "mutated";
    expect(sharedEntries[0].key).toBe("foo");
    if ("config_entries" in cachedBody) {
      expect(cachedBody.config_entries[0].key).toBe("foo");
    }
    expect(result.succeeded).toBe(1);
  });

  it("counts and logs missing-body responses", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchBody: (
      api: ESPHomeAPI,
      type: AutomationCatalogBodyType,
      id: string
    ) => Promise<AutomationCatalogBody | null> = async (_api, _type, _id) => null;
    const available = slimAvailable();

    const result = await hydrateAvailableBodies(makeApi(), available, fetchBody);

    expect(available.triggers[1].config_entries).toEqual([]);
    expect(result.missingBody).toBe(3);
    expect(result.succeeded).toBe(0);
    expect(
      warnSpy.mock.calls.some(
        (args) =>
          String(args[0]).includes("triggers/missing") &&
          String(args[0]).includes("no body returned")
      )
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it("counts body shapes missing config_entries separately from null bodies", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchBody = vi.fn(async (_api, _type, id) => {
      if (id === "good") return triggerBody("good", []);
      // Body present but no config_entries field — contract violation
      // of a different flavor than null.
      return { id, name: id } as unknown as AutomationCatalogBody;
    });
    const available = slimAvailable();

    const result = await hydrateAvailableBodies(makeApi(), available, fetchBody);

    expect(result.succeeded).toBe(1);
    expect(result.missingField).toBe(2);
    expect(result.missingBody).toBe(0);
    expect(
      warnSpy.mock.calls.some((args) =>
        String(args[0]).includes("body shape missing config_entries")
      )
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it("tolerates a rejected body fetch and keeps hydrating the rest", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchBody = vi.fn(async (_api, _type, id) => {
      if (id === "boom") throw new Error("network down");
      if (id === "good") return triggerBody("good", [configEntry("foo")]);
      return null;
    });
    const available = slimAvailable();

    const result = await hydrateAvailableBodies(makeApi(), available, fetchBody);

    expect(available.triggers[0].config_entries).toEqual([configEntry("foo")]);
    expect(result.rejected).toBe(1);
    expect(result.missingBody).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(
      warnSpy.mock.calls.some((args) => String(args[0]).includes("body fetch failed"))
    ).toBe(true);
    warnSpy.mockRestore();
  });
});

describe("loadAndHydrateAvailable", () => {
  const emptySlim = (): AvailableAutomations =>
    ({
      triggers: [],
      actions: [],
      conditions: [],
      scripts: [],
      devices: [],
    }) as unknown as AvailableAutomations;

  it("issues exactly one getAvailableAutomations call per invocation", async () => {
    const slim = emptySlim();
    const getAvailableAutomations = vi.fn().mockResolvedValue(slim);
    const api = { getAvailableAutomations } as unknown as ESPHomeAPI;

    const outcome = await loadAndHydrateAvailable(api, "device.yaml");

    expect(getAvailableAutomations).toHaveBeenCalledTimes(1);
    expect(getAvailableAutomations).toHaveBeenCalledWith("device.yaml");
    expect(outcome.status).toBe("ok");
  });

  it("returns fresh array refs in the hydrated outcome", async () => {
    const slim = emptySlim();
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(slim),
    } as unknown as ESPHomeAPI;
    // Capture the slim ref the orchestration paints through ``onSlim``
    // so we can compare against the post-hydration arrays.
    let painted: AvailableAutomations | null = null;

    const outcome = await loadAndHydrateAvailable(api, "device.yaml", {
      onSlim: (s) => {
        painted = s;
      },
    });
    if (outcome.status !== "ok") throw new Error("expected ok");
    if (painted === null) throw new Error("expected onSlim to fire");
    const slimPainted: AvailableAutomations = painted;

    expect(outcome.available).not.toBe(slimPainted);
    expect(outcome.available.triggers).not.toBe(slimPainted.triggers);
    expect(outcome.available.actions).not.toBe(slimPainted.actions);
    expect(outcome.available.conditions).not.toBe(slimPainted.conditions);
  });

  it("keeps the slim snapshot immutable during hydration", async () => {
    // ``onSlim`` should hand the caller a stable view; the
    // hydration mutations land on ``available`` (which is a
    // per-entry shallow clone), never on the snapshot the picker
    // paints from.
    const slim = {
      triggers: [
        { id: "on_boot", config_entries: [] as ConfigEntry[] } as AutomationTrigger,
      ],
      actions: [] as AutomationAction[],
      conditions: [] as AutomationCondition[],
      scripts: [],
      devices: [],
    } as unknown as AvailableAutomations;
    const body: AutomationCatalogBody = {
      id: "on_boot",
      name: "On Boot",
      description: "",
      docs_url: "",
      applies_to: [],
      is_device_level: true,
      config_entries: [configEntry("interval")],
    } as AutomationCatalogBody;
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(slim),
    } as unknown as ESPHomeAPI;
    let painted: AvailableAutomations | null = null;

    const outcome = await loadAndHydrateAvailable(api, "device.yaml", {
      onSlim: (s) => {
        painted = s;
      },
    });
    // Force-hydrate ``available`` separately so the entry's
    // ``config_entries`` is populated.
    if (outcome.status !== "ok") throw new Error("expected ok");
    await hydrateAvailableBodies(api, outcome.available, async () => body);

    expect(painted).toBe(slim);
    // The slim snapshot's entry still has its original empty
    // ``config_entries``; only ``available``'s shallow-cloned
    // entry got hydrated.
    expect(slim.triggers[0].config_entries).toEqual([]);
    expect(outcome.available.triggers[0]).not.toBe(slim.triggers[0]);
  });

  it("paints via onSlim before awaiting hydration", async () => {
    const slim = emptySlim();
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(slim),
    } as unknown as ESPHomeAPI;
    const onSlim = vi.fn();

    await loadAndHydrateAvailable(api, "device.yaml", { onSlim });

    expect(onSlim).toHaveBeenCalledTimes(1);
    expect(onSlim).toHaveBeenCalledWith(slim);
  });

  it("returns 'stale' when isStale flips during the fetch", async () => {
    const slim = emptySlim();
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(slim),
    } as unknown as ESPHomeAPI;
    const onSlim = vi.fn();

    const outcome = await loadAndHydrateAvailable(api, "device.yaml", {
      onSlim,
      isStale: () => true,
    });

    expect(outcome.status).toBe("stale");
    expect(onSlim).not.toHaveBeenCalled();
  });

  it("returns 'error' when the api call rejects", async () => {
    const api = {
      getAvailableAutomations: vi.fn().mockRejectedValue(new Error("network down")),
    } as unknown as ESPHomeAPI;

    const outcome = await loadAndHydrateAvailable(api, "device.yaml");

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect((outcome.error as Error).message).toBe("network down");
    }
  });

  it("error path defers to 'stale' when the load was superseded", async () => {
    const api = {
      getAvailableAutomations: vi.fn().mockRejectedValue(new Error("net")),
    } as unknown as ESPHomeAPI;

    const outcome = await loadAndHydrateAvailable(api, "device.yaml", {
      isStale: () => true,
    });

    expect(outcome.status).toBe("stale");
  });
});
