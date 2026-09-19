/**
 * Minimal ``ComponentCatalogEntry`` factory for test fixtures. The
 * default shape is the wire shape of a field-less ``misc`` component
 * after the API client's backfill — pass ``overrides`` to set anything a test
 * actually cares about (typically ``category`` and / or
 * ``multi_conf``). Mirrors ``_make-config-entry.ts`` and lives
 * under ``test/util/`` so the file isn't picked up by the
 * ``test/**\/*.test.ts`` vitest glob.
 */
import {
  type ComponentCatalogEntry,
  ComponentCategory,
} from "../../src/api/types/components.js";

export function makeComponentEntry(
  id: string,
  overrides: Partial<ComponentCatalogEntry> = {}
): ComponentCatalogEntry {
  return {
    id,
    name: id,
    description: "",
    category: ComponentCategory.MISC,
    config_entries: [],
    ...overrides,
  };
}
