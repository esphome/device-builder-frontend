import { describe, expect, test, vi } from "vitest";

import {
  navigateToDep,
  type DepNavHost,
} from "../../../src/components/device/add-component-dialog-dep-nav.js";
import type { ComponentCatalogEntry } from "../../../src/api/types.js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";

function makeHost(
  getComponent: (...args: unknown[]) => unknown,
  catalog: NonNullable<DepNavHost["_catalog"]> | null = null,
): DepNavHost {
  return {
    _api: { getComponent } as unknown as ESPHomeAPI,
    platform: "esp32",
    board: { id: "apollo-esk-1" },
    _catalog: catalog,
    _selected: null,
    _returnTo: null,
    _depDomain: null,
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

describe("navigateToDep", () => {
  const aht20 = makeComponentEntry("sensor.aht10");
  const i2c = makeComponentEntry("i2c");
  const uart = makeComponentEntry("uart");

  test("exact-id dep retargets the form to the fetched component", async () => {
    const getComponent = vi.fn().mockResolvedValue(i2c);
    const filterByDomain = vi.fn();
    const host = makeHost(getComponent, { filterByDomain });
    host._selected = aht20;

    await navigateToDep(host, "i2c");

    expect(getComponent).toHaveBeenCalledWith("i2c", "esp32", "apollo-esk-1");
    expect(host._selected).toBe(i2c);
    expect(host._returnTo).toBe(aht20);
    expect(host._depDomain).toBe("i2c");
    expect(filterByDomain).not.toHaveBeenCalled();
  });

  test("domain-level dep with no matching id falls back to the catalog filter", async () => {
    const getComponent = vi.fn().mockResolvedValue(null);
    const filterByDomain = vi.fn();
    const host = makeHost(getComponent, { filterByDomain });
    host._selected = aht20;

    await navigateToDep(host, "output");

    expect(getComponent).toHaveBeenCalledWith("output", "esp32", "apollo-esk-1");
    expect(host._selected).toBeNull();
    expect(host._returnTo).toBe(aht20);
    expect(host._depDomain).toBe("output");
    expect(filterByDomain).toHaveBeenCalledWith("output");
  });

  test("a transient getComponent failure falls back to the catalog filter", async () => {
    const getComponent = vi.fn().mockRejectedValue(new Error("boom"));
    const filterByDomain = vi.fn();
    const host = makeHost(getComponent, { filterByDomain });
    host._selected = aht20;

    await navigateToDep(host, "i2c");

    expect(host._selected).toBeNull();
    expect(filterByDomain).toHaveBeenCalledWith("i2c");
  });

  test("a stale getComponent response is dropped after _depNavSeq bumps", async () => {
    // Simulates the dialog's _resetDetourState / _onFormSubmit bumping
    // the seq while the lookup is in flight (user closed + reopened,
    // submitted the form, or clicked a different dep).
    const d = deferred<ComponentCatalogEntry>();
    const filterByDomain = vi.fn();
    const host = makeHost(() => d.promise, { filterByDomain });
    host._selected = aht20;

    const navPromise = navigateToDep(host, "i2c");
    host._depNavSeq++;
    d.resolve(i2c);
    await navPromise;

    expect(host._selected).toBe(aht20);
    expect(filterByDomain).not.toHaveBeenCalled();
  });

  test("_returnTo stays null while the exact-id lookup is in flight", async () => {
    // The original form is still rendered during the lookup, so a
    // submit reaching _onFormSubmit must NOT see _returnTo set (which
    // would misclassify the submit as completing a dep detour).
    const d = deferred<ComponentCatalogEntry>();
    const host = makeHost(() => d.promise);
    host._selected = aht20;

    const navPromise = navigateToDep(host, "i2c");
    expect(host._returnTo).toBeNull();
    expect(host._depDomain).toBeNull();

    d.resolve(i2c);
    await navPromise;
    expect(host._returnTo).toBe(aht20);
    expect(host._depDomain).toBe("i2c");
  });

  test("a superseded navigation does not race against the latest one", async () => {
    const first = deferred<ComponentCatalogEntry>();
    const second = deferred<ComponentCatalogEntry>();
    const getComponent = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const host = makeHost(getComponent);
    host._selected = aht20;

    const firstNav = navigateToDep(host, "i2c");
    const secondNav = navigateToDep(host, "uart");
    // First responds *after* second was issued — late arrival must
    // not stomp on the newer navigation's result.
    second.resolve(uart);
    first.resolve(i2c);
    await Promise.all([firstNav, secondNav]);

    expect(host._selected).toBe(uart);
  });

  test("does nothing while a submit is in flight", async () => {
    const getComponent = vi.fn();
    const filterByDomain = vi.fn();
    const host = makeHost(getComponent, { filterByDomain });
    host._submitting = true;
    const before = host._selected;

    await navigateToDep(host, "i2c");

    expect(getComponent).not.toHaveBeenCalled();
    expect(filterByDomain).not.toHaveBeenCalled();
    expect(host._selected).toBe(before);
  });
});
