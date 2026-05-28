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
  it("populates config_entries from the body cache and clones the array", async () => {
    const sharedEntries = [configEntry("foo"), configEntry("bar")];
    const fetchBody = vi.fn(async (_api, type, id) => {
      if (type === "triggers" && id === "good") {
        return triggerBody("good", sharedEntries);
      }
      return null;
    });
    const available = slimAvailable();
    const goodEntry = available.triggers[0];

    await hydrateAvailableBodies(makeApi(), available, fetchBody);

    expect(goodEntry.config_entries).toEqual(sharedEntries);
    // Cloned, not aliased — mutating the entry's array can't leak
    // back into the cached body.
    expect(goodEntry.config_entries).not.toBe(sharedEntries);
  });

  it("logs and skips entries whose body is missing config_entries", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchBody: (
      api: ESPHomeAPI,
      type: AutomationCatalogBodyType,
      id: string
    ) => Promise<AutomationCatalogBody | null> = async (_api, _type, _id) => null;
    const available = slimAvailable();

    await hydrateAvailableBodies(makeApi(), available, fetchBody);

    expect(available.triggers[1].config_entries).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some(
        (args) =>
          String(args[0]).includes("triggers/missing") &&
          String(args[0]).includes("no body returned")
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

    await hydrateAvailableBodies(makeApi(), available, fetchBody);

    expect(available.triggers[0].config_entries).toEqual([configEntry("foo")]);
    expect(
      warnSpy.mock.calls.some((args) => String(args[0]).includes("body fetch failed"))
    ).toBe(true);
    warnSpy.mockRestore();
  });
});
