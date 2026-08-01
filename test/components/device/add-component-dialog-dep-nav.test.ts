import { afterEach, describe, expect, test, vi } from "vitest";

import type { ESPHomeAPI } from "../../../src/api/index.js";
import {
  type ComponentCatalogEntry,
  ComponentCategory,
} from "../../../src/api/types/components.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import {
  type DepNavHost,
  type DetourFrame,
  type DetourHost,
  matchesDepDomain,
  navigateToDep,
  popDetour,
} from "../../../src/components/device/add-component-dialog-dep-nav.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";
import { makeDetourFrame } from "../../util/_make-detour-frame.js";

function makeHost(
  getComponentBodies: (...args: unknown[]) => unknown,
  catalog: NonNullable<DepNavHost["_catalog"]> | null = null
): DepNavHost {
  return {
    _api: { getComponentBodies } as unknown as ESPHomeAPI,
    platform: "esp32",
    board: { id: "apollo-esk-1" },
    _catalog: catalog,
    _selected: null,
    _detourStack: [],
    _returnValues: null,
    _depPrefill: null,
    _submitError: "",
    _submitting: false,
    _depNavSeq: 0,
    updateComplete: Promise.resolve(true),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** `fetchComponent` routes through `getComponentBodies` and returns
 *  the entry under the requested id (or null when absent). Tests
 *  pass the entries they want served, keyed by id. */
const respond = (...entries: (ComponentCatalogEntry | null)[]) => {
  const byId = new Map(entries.filter((e) => e !== null).map((e) => [e.id, e]));
  return vi.fn().mockImplementation((ids: string[]) => {
    const entry = byId.get(ids[0]);
    return Promise.resolve(entry ? { [ids[0]]: entry } : {});
  });
};

describe("navigateToDep", () => {
  const aht20 = makeComponentEntry("sensor.aht10");
  const i2c = makeComponentEntry("i2c");
  const uart = makeComponentEntry("uart");

  afterEach(() => _clearComponentCache());

  test("exact-id dep retargets the form to the fetched component", async () => {
    const getComponentBodies = respond(i2c);
    const filterByDomain = vi.fn();
    const host = makeHost(getComponentBodies, { filterByDomain });
    host._selected = aht20;

    await navigateToDep(host, "i2c");

    expect(getComponentBodies).toHaveBeenCalledWith(["i2c"], "esp32", "apollo-esk-1");
    expect(host._selected).toBe(i2c);
    expect(host._detourStack).toHaveLength(1);
    expect(host._detourStack[0].component).toBe(aht20);
    expect(host._detourStack[0].depDomain).toBe("i2c");
    expect(filterByDomain).not.toHaveBeenCalled();
  });

  test("domain-level dep with no matching id falls back to the catalog filter", async () => {
    const getComponentBodies = respond(null);
    const filterByDomain = vi.fn();
    const host = makeHost(getComponentBodies, { filterByDomain });
    host._selected = aht20;

    await navigateToDep(host, "output");

    expect(getComponentBodies).toHaveBeenCalledWith(["output"], "esp32", "apollo-esk-1");
    expect(host._selected).toBeNull();
    expect(host._detourStack[0].component).toBe(aht20);
    expect(host._detourStack[0].depDomain).toBe("output");
    expect(filterByDomain).toHaveBeenCalledWith("output");
  });

  test("a transient backend failure falls back to the catalog filter", async () => {
    const getComponentBodies = vi.fn().mockRejectedValue(new Error("boom"));
    const filterByDomain = vi.fn();
    const host = makeHost(getComponentBodies, { filterByDomain });
    host._selected = aht20;

    await navigateToDep(host, "i2c");

    expect(host._selected).toBeNull();
    expect(filterByDomain).toHaveBeenCalledWith("i2c");
  });

  test("a stale response is dropped after _depNavSeq bumps", async () => {
    // Simulates _resetDetourState or _onFormSubmit bumping mid-flight.
    const d = deferred<Record<string, ComponentCatalogEntry>>();
    const filterByDomain = vi.fn();
    const host = makeHost(() => d.promise, { filterByDomain });
    host._selected = aht20;

    const navPromise = navigateToDep(host, "i2c");
    host._depNavSeq++;
    d.resolve({ i2c });
    await navPromise;

    expect(host._selected).toBe(aht20);
    expect(host._detourStack).toHaveLength(0);
    expect(filterByDomain).not.toHaveBeenCalled();
  });

  test("the frame is pushed only once the exact-id lookup resolves", async () => {
    // A submit during this window would otherwise be misclassified
    // as completing a dep detour by _onFormSubmit.
    const d = deferred<Record<string, ComponentCatalogEntry>>();
    const host = makeHost(() => d.promise);
    host._selected = aht20;

    const navPromise = navigateToDep(host, "i2c");
    expect(host._detourStack).toHaveLength(0);

    d.resolve({ i2c });
    await navPromise;
    expect(host._detourStack[0].component).toBe(aht20);
    expect(host._detourStack[0].depDomain).toBe("i2c");
  });

  test("the frame carries the level's in-progress values and prefill", async () => {
    const host = makeHost(respond(i2c));
    host._selected = aht20;
    host._depPrefill = { fields: { frequency: "15kHz" }, required: [] };

    await navigateToDep(host, "i2c", { name: "Cooker" });

    expect(host._detourStack[0].values).toEqual({ name: "Cooker" });
    expect(host._detourStack[0].prefill).toEqual({
      fields: { frequency: "15kHz" },
      required: [],
    });
  });

  test("a dep of a dep pushes a second frame and keeps the first", async () => {
    const bleClient = makeComponentEntry("ble_client");
    const tracker = makeComponentEntry("esp32_ble_tracker");
    const anova = makeComponentEntry("climate.anova");
    const host = makeHost(respond(bleClient, tracker));
    host._selected = anova;

    await navigateToDep(host, "ble_client");
    await navigateToDep(host, "esp32_ble_tracker");

    expect(host._selected).toBe(tracker);
    expect(host._detourStack.map((f) => f.component)).toEqual([anova, bleClient]);
    expect(host._detourStack.map((f) => f.depDomain)).toEqual([
      "ble_client",
      "esp32_ble_tracker",
    ]);
  });

  test("hands the requester's prefill to the frame, not to the catalog pick", async () => {
    // The domain-level fallback leaves the user in the catalog; whatever they
    // pick must not inherit the requester's bus values.
    const host = makeHost(respond(null), { filterByDomain: vi.fn() });
    host._selected = aht20;
    host._depPrefill = { fields: { frequency: "15kHz" }, required: [] };

    await navigateToDep(host, "output");

    expect(host._depPrefill).toBeNull();
    expect(host._detourStack[0].prefill).toEqual({
      fields: { frequency: "15kHz" },
      required: [],
    });
  });

  test("pushes nothing when the detour starts from the catalog", async () => {
    const host = makeHost(respond(i2c));

    await navigateToDep(host, "i2c");

    expect(host._detourStack).toHaveLength(0);
  });

  test("a superseded navigation does not race against the latest one", async () => {
    // Both navigations queue into one batched `getComponentBodies`
    // call; the seq guard inside navigateToDep is what prevents
    // the earlier (now superseded) call from applying its result.
    const batch = deferred<Record<string, ComponentCatalogEntry>>();
    const getComponentBodies = vi.fn().mockReturnValue(batch.promise);
    const host = makeHost(getComponentBodies);
    host._selected = aht20;

    const firstNav = navigateToDep(host, "i2c");
    const secondNav = navigateToDep(host, "uart");
    batch.resolve({ i2c, uart });
    await Promise.all([firstNav, secondNav]);

    expect(host._selected).toBe(uart);
    expect(host._detourStack).toHaveLength(1);
    expect(host._detourStack[0].depDomain).toBe("uart");
    expect(getComponentBodies).toHaveBeenCalledTimes(1);
  });

  test("does nothing while a submit is in flight", async () => {
    const getComponentBodies = vi.fn();
    const filterByDomain = vi.fn();
    const host = makeHost(getComponentBodies, { filterByDomain });
    host._submitting = true;
    const before = host._selected;

    await navigateToDep(host, "i2c");

    expect(getComponentBodies).not.toHaveBeenCalled();
    expect(filterByDomain).not.toHaveBeenCalled();
    expect(host._selected).toBe(before);
  });
});

describe("popDetour", () => {
  const anova = makeComponentEntry("climate.anova");
  const bleClient = makeComponentEntry("ble_client");
  const prefill = { fields: { frequency: "15kHz" }, required: [] };
  const detourHost = (stack: DetourFrame[]): DetourHost => ({
    _selected: null,
    _detourStack: stack,
    _returnValues: null,
    _depPrefill: null,
  });

  test("restores the top frame's component, values and prefill", () => {
    const host = detourHost([
      makeDetourFrame(anova, {
        depDomain: "ble_client",
        values: { name: "Cooker" },
        prefill,
      }),
    ]);
    host._selected = makeComponentEntry("esp32_ble_tracker");

    const frame = popDetour(host);

    expect(frame?.component).toBe(anova);
    expect(host._selected).toBe(anova);
    expect(host._returnValues).toEqual({ name: "Cooker" });
    expect(host._detourStack).toHaveLength(0);
  });

  test("keeps the frame's prefill constraints but not its values", () => {
    // The snapshot already carries what the prefill seeded, edits included, and
    // `prefillFields` is merged after `restoredValues` in the form seed.
    const host = detourHost([
      makeDetourFrame(anova, { values: { frequency: "20kHz" }, prefill }),
    ]);

    popDetour(host);

    expect(host._depPrefill).toEqual({ fields: {}, required: [] });
  });

  test("keeps the frame's prefill whole when the level had no values", () => {
    const host = detourHost([makeDetourFrame(anova, { prefill })]);

    popDetour(host);

    expect(host._depPrefill).toBe(prefill);
  });

  test("unwinds a nested chain one level per call", () => {
    const host = detourHost([makeDetourFrame(anova), makeDetourFrame(bleClient)]);

    expect(popDetour(host)?.component).toBe(bleClient);
    expect(host._detourStack).toHaveLength(1);
    expect(popDetour(host)?.component).toBe(anova);
    expect(host._detourStack).toHaveLength(0);
  });

  test("returns null and changes nothing on an empty stack", () => {
    const host = detourHost([]);
    host._selected = bleClient;

    expect(popDetour(host)).toBeNull();
    expect(host._selected).toBe(bleClient);
  });
});

describe("matchesDepDomain", () => {
  test("matches by exact id for top-level bus deps", () => {
    // i2c.category is "bus", not "i2c"; the prefill check in
    // _onFormSubmit must still recognise the just-added bus as the
    // dep so an ID-reference dropdown auto-selects the new id.
    const i2c = makeComponentEntry("i2c", { category: ComponentCategory.BUS });
    expect(matchesDepDomain(i2c, "i2c")).toBe(true);
  });

  test("matches by category for domain-level deps", () => {
    const gpio = makeComponentEntry("output.gpio", {
      category: ComponentCategory.OUTPUT,
    });
    expect(matchesDepDomain(gpio, "output")).toBe(true);
  });

  test("rejects an off-domain catalog pick", () => {
    const sensor = makeComponentEntry("sensor.dht", {
      category: ComponentCategory.SENSOR,
    });
    expect(matchesDepDomain(sensor, "output")).toBe(false);
  });
});

describe("navigateToDep bus-constraint prefill", () => {
  afterEach(() => _clearComponentCache());

  const i2cWithFrequency = () =>
    makeComponentEntry("i2c", {
      config_entries: [
        makeConfigEntry({
          key: "frequency",
          type: ConfigEntryType.FLOAT_WITH_UNIT,
          default_value: "50kHz",
          unit_options: ["Hz", "kHz", "MHz"],
        }),
      ],
    });

  test("stashes a prefill when the requester constrains the bus", async () => {
    const host = makeHost(respond(i2cWithFrequency()));
    host._selected = makeComponentEntry("sensor.ags10", {
      bus_constraints: { i2c: { max_frequency: 15000 } },
    });

    await navigateToDep(host, "i2c");

    expect(host._depPrefill).toEqual({ fields: { frequency: "15kHz" }, required: [] });
  });

  test("leaves the prefill null for an unconstrained requester", async () => {
    const host = makeHost(respond(i2cWithFrequency()));
    host._selected = makeComponentEntry("sensor.dht");

    await navigateToDep(host, "i2c");

    expect(host._depPrefill).toBeNull();
  });
});

describe("navigateToDep featured-hub prefill", () => {
  afterEach(() => _clearComponentCache());

  const hubFeatured = {
    id: "bp5758d_hub",
    component_id: "bp5758d",
    name: null,
    description: null,
    fields: {
      clock_pin: { value: 26, locked: true, suggestions: null },
      data_pin: { value: 24, locked: true, suggestions: null },
    },
  };

  test("applies a board featured hub's locked pins when reached via the detour", async () => {
    const bp5758d = makeComponentEntry("bp5758d", {
      config_entries: [
        makeConfigEntry({ key: "clock_pin", type: ConfigEntryType.PIN }),
        makeConfigEntry({ key: "data_pin", type: ConfigEntryType.PIN }),
      ],
    });
    const host = makeHost(respond(bp5758d));
    host.board = { id: "arlec", featured_components: [hubFeatured] };
    host._selected = makeComponentEntry("output.bp5758d");

    await navigateToDep(host, "bp5758d");

    // Values arrive via the prefill...
    expect(host._depPrefill).toEqual({
      fields: { clock_pin: 26, data_pin: 24 },
      required: [],
    });
    // ...and the locked state is carried onto the dep component's entries.
    const locked = Object.fromEntries(
      host._selected!.config_entries.map((e) => [e.key, e.locked])
    );
    expect(locked).toEqual({ clock_pin: true, data_pin: true });
  });

  test("leaves the prefill null when no featured entry materializes the dep", async () => {
    const host = makeHost(respond(makeComponentEntry("bp5758d")));
    host.board = { id: "arlec", featured_components: [] };
    host._selected = makeComponentEntry("output.bp5758d");

    await navigateToDep(host, "bp5758d");

    expect(host._depPrefill).toBeNull();
  });
});
