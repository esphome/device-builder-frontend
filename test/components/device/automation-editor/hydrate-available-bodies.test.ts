import { describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../../../src/api/index.js";
import type {
  AutomationCatalogBody,
  AutomationCatalogBodyType,
  AvailableAutomations,
  ConfigEntry,
} from "../../../../src/api/types.js";
import { hydrateAvailableBodies } from "../../../../src/components/device/automation-editor/hydrate-available-bodies.js";

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
