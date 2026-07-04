import { afterEach, describe, expect, test, vi } from "vitest";

import type { ESPHomeAPI } from "../../../src/api/index.js";
import {
  ComponentCategory,
  type ComponentCatalogEntry,
} from "../../../src/api/types/components.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import {
  matchesDepDomain,
  navigateToDep,
  type DepNavHost,
} from "../../../src/components/device/add-component-dialog-dep-nav.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

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
    _returnTo: null,
    _depDomain: null,
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
 *  pass the entry they want returned and this helper wraps it. */
const respond = (entry: ComponentCatalogEntry | null) =>
  vi
    .fn()
    .mockImplementation((ids: string[]) =>
      Promise.resolve(entry ? { [ids[0]]: entry } : {})
    );

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
    expect(host._returnTo).toBe(aht20);
    expect(host._depDomain).toBe("i2c");
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
    expect(host._returnTo).toBe(aht20);
    expect(host._depDomain).toBe("output");
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
    expect(filterByDomain).not.toHaveBeenCalled();
  });

  test("_returnTo stays null while the exact-id lookup is in flight", async () => {
    // A submit during this window would otherwise be misclassified
    // as completing a dep detour by _onFormSubmit.
    const d = deferred<Record<string, ComponentCatalogEntry>>();
    const host = makeHost(() => d.promise);
    host._selected = aht20;

    const navPromise = navigateToDep(host, "i2c");
    expect(host._returnTo).toBeNull();
    expect(host._depDomain).toBeNull();

    d.resolve({ i2c });
    await navPromise;
    expect(host._returnTo).toBe(aht20);
    expect(host._depDomain).toBe("i2c");
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
