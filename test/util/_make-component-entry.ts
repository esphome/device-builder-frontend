/**
 * Minimal ``ComponentCatalogEntry`` factory for test fixtures. The
 * default shape is the catch-all ``misc`` category, no deps, no
 * config entries — pass ``overrides`` to set anything a test
 * actually cares about (typically ``category`` and / or
 * ``multi_conf``). Mirrors ``_make-config-entry.ts`` and lives
 * under ``test/util/`` so the file isn't picked up by the
 * ``test/**\/*.test.ts`` vitest glob.
 */
import { ComponentCategory, type ComponentCatalogEntry } from "../../src/api/types.js";

export function makeComponentEntry(
  id: string,
  overrides: Partial<ComponentCatalogEntry> = {}
): ComponentCatalogEntry {
  return {
    id,
    name: id,
    description: "",
    category: ComponentCategory.MISC,
    docs_url: "",
    image_url: "",
    dependencies: [],
    multi_conf: false,
    supported_platforms: [],
    config_entries: [],
    ...overrides,
  };
}
