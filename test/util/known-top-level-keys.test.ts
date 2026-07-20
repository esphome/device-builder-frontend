/**
 * Pins ``knownTopLevelKeys`` — the set the device page uses to hold a
 * section switch onto a half-typed unknown top-level key (#2211).
 */
import { describe, expect, it } from "vitest";
import {
  type ComponentCatalogEntry,
  ComponentCategory,
} from "../../src/api/types/components.js";
import { knownTopLevelKeys } from "../../src/util/yaml-completion-items.js";
import { makeComponentEntry } from "./_make-component-entry.js";

type CatalogIndex = Parameters<typeof knownTopLevelKeys>[0];

const entry = (id: string, category: ComponentCategory) =>
  makeComponentEntry(id, { category });

function catalog(entries: ComponentCatalogEntry[]): CatalogIndex {
  const byId = new Map<string, ComponentCatalogEntry>();
  const byCategory = new Map<string, ComponentCatalogEntry[]>();
  for (const e of entries) {
    byId.set(e.id, e);
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }
  return { components: entries, byId, byCategory };
}

describe("knownTopLevelKeys", () => {
  it("unions domain umbrellas, standalone ids, and core/automation keys", () => {
    const keys = knownTopLevelKeys(
      catalog([
        entry("binary_sensor.gpio", ComponentCategory.BINARY_SENSOR),
        entry("http_request", ComponentCategory.MISC),
      ])
    );
    expect(keys).not.toBeNull();
    // Domain umbrella from the dotted id; the dotted id itself is not a key.
    expect(keys!.has("binary_sensor")).toBe(true);
    expect(keys!.has("binary_sensor.gpio")).toBe(false);
    // Standalone component id.
    expect(keys!.has("http_request")).toBe(true);
    // Core and automation sections without catalog entries.
    expect(keys!.has("esphome")).toBe(true);
    expect(keys!.has("substitutions")).toBe(true);
    expect(keys!.has("script")).toBe(true);
    // A half-typed key is unknown.
    expect(keys!.has("sendx")).toBe(false);
  });

  it("returns null for an empty catalog (failed fetch resolves empty)", () => {
    // Callers must treat null as everything-known so a transient catalog
    // failure degrades to no holds, not to holding every typed switch.
    expect(knownTopLevelKeys(catalog([]))).toBeNull();
  });

  it("memoizes per catalog identity", () => {
    const c = catalog([entry("http_request", ComponentCategory.MISC)]);
    expect(knownTopLevelKeys(c)).toBe(knownTopLevelKeys(c));
  });
});
