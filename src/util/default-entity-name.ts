import { isPlatformComponentId } from "./featured-id.js";
import { collectInstanceScalars } from "./yaml-sections-core.js";

/**
 * Collision key mirroring esphome's str_sanitize(str_snake_case(name)),
 * the exact normalization its duplicate-entity-name validator compares
 * with (core/entity_helpers.py): spaces to underscores, lowercase, then
 * every char outside [a-z0-9-_] to underscore.
 */
function nameKey(name: string): string {
  return name
    .replace(/ /g, "_")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
}

/**
 * Suggest a default 'name:' for a component being added via the
 * catalog: the catalog title, suffixed with a counter when the title
 * already names an entity in the YAML. Used by
 * 'esphome-add-component-form' to seed the name field; the user can
 * edit it (or clear it) before submitting.
 *
 * Only platform entries (id contains '.', e.g. 'switch.gpio') are
 * seeded: they are entity platforms, where 'name' becomes the Home
 * Assistant entity name and an unnamed entity stays internal. On the
 * few undotted components with a top-level 'name' field (esphome,
 * esp32_ble, sprinkler, ...) the key means something else, so they
 * return null. Featured wraps also return null: their name presets
 * arrive through seedDefaults, and their display title is a poor
 * entity name.
 */
export function suggestEntityName(
  componentId: string,
  componentTitle: string,
  existingNames: ReadonlySet<string>
): string | null {
  if (!isPlatformComponentId(componentId)) return null;
  const title = componentTitle.trim();
  if (!title) return null;

  const taken = new Set<string>();
  for (const name of existingNames) {
    const key = nameKey(name);
    if (key) taken.add(key);
  }
  if (!taken.has(nameKey(title))) return title;
  let n = 2;
  let candidate = `${title} ${n}`;
  while (taken.has(nameKey(candidate))) {
    n++;
    candidate = `${title} ${n}`;
  }
  return candidate;
}

/**
 * Scan the YAML for every 'name:' line under the *domain* top-level
 * section, matching the scope of esphome's per-platform duplicate
 * check. Still over-collects within the section (nested sub-entity
 * names, sub-device duplicates esphome would allow); the cost of a
 * false hit is an unneeded numeric suffix. The scan is line-based: a
 * name behind a block scalar or inside a packages/!include file is
 * invisible and can still collide; the user can still edit the seeded
 * value before submitting.
 */
export function collectExistingNames(yaml: string, domain: string): Set<string> {
  return collectInstanceScalars(yaml, "name", domain);
}
