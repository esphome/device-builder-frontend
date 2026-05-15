// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";

import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";
import { ComponentCategory } from "../../../src/api/types.js";
import type { ComponentCatalogEntry } from "../../../src/api/types.js";
import type { ESPHomeComponentCatalog } from "../../../src/components/device/component-catalog.js";

/**
 * Regression coverage for the missing-deps "Add <domain>" flow.
 *
 * Top-level deps like ``i2c`` resolve to a single catalog id. The
 * dialog must fetch that entry by id and retarget the form
 * directly; routing through the catalog's fuzzy text search ranks
 * every sensor whose description mentions the bus name above the
 * bus entry itself (132 matches for ``i2c`` on the Apollo ESK).
 *
 * Domain-level deps (``output``, ``sensor``) don't resolve to a
 * single id, so the dialog falls back to the catalog filtered by
 * category where the user picks a variant.
 */

function makeComponent(
  id: string,
  overrides: Partial<ComponentCatalogEntry> = {},
): ComponentCatalogEntry {
  return {
    id,
    name: id,
    description: "",
    category: ComponentCategory.BUS,
    docs_url: "",
    image_url: "",
    dependencies: [],
    multi_conf: true,
    supported_platforms: [],
    config_entries: [],
    ...overrides,
  };
}

interface DialogPrivateView extends EventTarget {
  _api: { getComponent: (...args: unknown[]) => unknown };
  _catalog: Pick<ESPHomeComponentCatalog, "filterByDomain"> | null;
  _selected: ComponentCatalogEntry | null;
  _returnTo: ComponentCatalogEntry | null;
  _depDomain: string | null;
  _submitError: string;
  _submitting: boolean;
  platform: string;
  board: { id: string } | null;
  _onNavigateToDep(e: CustomEvent<{ domain: string }>): Promise<void>;
  _resetDetourState(): void;
  updateComplete: Promise<boolean>;
}

function makeDialog(
  getComponent: (...args: unknown[]) => unknown,
  catalog: { filterByDomain: ReturnType<typeof vi.fn> } | null = null,
): DialogPrivateView {
  const dialog = new ESPHomeAddComponentDialog() as unknown as DialogPrivateView;
  dialog._api = { getComponent };
  // _catalog is a Lit @query getter on the prototype and
  // updateComplete blocks on a render that never happens for a
  // detached element. Override both on the instance.
  Object.defineProperty(dialog, "_catalog", { value: catalog, configurable: true });
  Object.defineProperty(dialog, "updateComplete", {
    get: () => Promise.resolve(true),
    configurable: true,
  });
  dialog.platform = "esp32";
  dialog.board = { id: "apollo-esk-1" };
  return dialog;
}

function depEvent(domain: string): CustomEvent<{ domain: string }> {
  return new CustomEvent("navigate-to-dep", { detail: { domain } });
}

describe("ESPHomeAddComponentDialog._onNavigateToDep", () => {
  test("exact-id dep retargets the form to the fetched component", async () => {
    const aht20 = makeComponent("sensor.aht10", {
      category: ComponentCategory.SENSOR,
      dependencies: ["i2c"],
    });
    const i2c = makeComponent("i2c");
    const getComponent = vi.fn().mockResolvedValue(i2c);
    const filterByDomain = vi.fn();
    const dialog = makeDialog(getComponent, { filterByDomain });
    dialog._selected = aht20;

    await dialog._onNavigateToDep(depEvent("i2c"));

    expect(getComponent).toHaveBeenCalledWith("i2c", "esp32", "apollo-esk-1");
    expect(dialog._selected).toBe(i2c);
    expect(dialog._returnTo).toBe(aht20);
    expect(dialog._depDomain).toBe("i2c");
    expect(filterByDomain).not.toHaveBeenCalled();
  });

  test("domain-level dep with no matching id falls back to the catalog filter", async () => {
    const aht20 = makeComponent("sensor.aht10", {
      category: ComponentCategory.SENSOR,
      dependencies: ["output"],
    });
    const getComponent = vi.fn().mockResolvedValue(null);
    const filterByDomain = vi.fn();
    const dialog = makeDialog(getComponent, { filterByDomain });
    dialog._selected = aht20;

    await dialog._onNavigateToDep(depEvent("output"));

    expect(getComponent).toHaveBeenCalledWith("output", "esp32", "apollo-esk-1");
    expect(dialog._selected).toBeNull();
    expect(dialog._returnTo).toBe(aht20);
    expect(dialog._depDomain).toBe("output");
    expect(filterByDomain).toHaveBeenCalledWith("output");
  });

  test("a transient getComponent failure falls back to the catalog filter", async () => {
    const aht20 = makeComponent("sensor.aht10");
    const getComponent = vi.fn().mockRejectedValue(new Error("boom"));
    const filterByDomain = vi.fn();
    const dialog = makeDialog(getComponent, { filterByDomain });
    dialog._selected = aht20;

    await dialog._onNavigateToDep(depEvent("i2c"));

    expect(dialog._selected).toBeNull();
    expect(filterByDomain).toHaveBeenCalledWith("i2c");
  });

  test("a stale getComponent response is dropped after the detour resets", async () => {
    // User clicks "Add i2c"; the request is in flight. They close +
    // reopen the dialog (which calls _resetDetourState) before the
    // response lands. The continuation must NOT silently retarget
    // the form to i2c after the user has moved on.
    const aht20 = makeComponent("sensor.aht10");
    const i2c = makeComponent("i2c");
    let resolveGetComponent: (value: ComponentCatalogEntry) => void = () => {};
    const getComponent = vi.fn(
      () =>
        new Promise<ComponentCatalogEntry>((resolve) => {
          resolveGetComponent = resolve;
        }),
    );
    const filterByDomain = vi.fn();
    const dialog = makeDialog(getComponent, { filterByDomain });
    dialog._selected = aht20;

    const navPromise = dialog._onNavigateToDep(depEvent("i2c"));
    dialog._resetDetourState();
    resolveGetComponent(i2c);
    await navPromise;

    expect(dialog._selected).toBe(aht20);
    expect(filterByDomain).not.toHaveBeenCalled();
  });

  test("a superseded navigation does not race against the latest one", async () => {
    const aht20 = makeComponent("sensor.aht10");
    const i2c = makeComponent("i2c");
    const uart = makeComponent("uart");
    let resolveFirst: (value: ComponentCatalogEntry) => void = () => {};
    let resolveSecond: (value: ComponentCatalogEntry) => void = () => {};
    const getComponent = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<ComponentCatalogEntry>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ComponentCatalogEntry>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const dialog = makeDialog(getComponent);
    dialog._selected = aht20;

    const firstNav = dialog._onNavigateToDep(depEvent("i2c"));
    const secondNav = dialog._onNavigateToDep(depEvent("uart"));
    // First responds *after* second was issued — late arrival must
    // not stomp on the newer navigation's result.
    resolveSecond(uart);
    resolveFirst(i2c);
    await Promise.all([firstNav, secondNav]);

    expect(dialog._selected).toBe(uart);
  });

  test("does nothing while a submit is in flight", async () => {
    const getComponent = vi.fn();
    const filterByDomain = vi.fn();
    const dialog = makeDialog(getComponent, { filterByDomain });
    dialog._submitting = true;
    const before = dialog._selected;

    await dialog._onNavigateToDep(depEvent("i2c"));

    expect(getComponent).not.toHaveBeenCalled();
    expect(filterByDomain).not.toHaveBeenCalled();
    expect(dialog._selected).toBe(before);
  });
});
