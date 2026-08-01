import { parseCatalogId } from "./config-entry-yaml-scan.js";
import { isFeaturedId, isPlatformComponentId } from "./featured-id.js";
import { collectInstanceScalars } from "./yaml-instance-scalars.js";

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
 * Undotted components whose top-level 'name' is an identity the firmware
 * derives elsewhere, not a label to seed: the node hostname, and the
 * advertised BLE name (which defaults to that hostname). Every other
 * undotted 'name' in the catalog is a display label — ble_client,
 * esp32_camera (an entity), serial_proxy, sprinkler.
 */
const IDENTITY_NAME_COMPONENTS: ReadonlySet<string> = new Set(["esphome", "esp32_ble"]);

/**
 * Suggest a default 'name:' for a component being added via the
 * catalog: the catalog title, suffixed with a counter when the title
 * already names an entity in the YAML. Used by
 * 'esphome-add-component-form' to seed the name field; the user can
 * edit it (or clear it) before submitting.
 *
 * Platform entries (id contains '.', e.g. 'switch.gpio') are entity
 * platforms, where 'name' becomes the Home Assistant entity name and an
 * unnamed entity stays internal. Undotted components are seeded too,
 * minus 'IDENTITY_NAME_COMPONENTS'. Featured wraps return null: their
 * name presets arrive through seedDefaults, and their display title is a
 * poor entity name.
 */
export function suggestEntityName(
  componentId: string,
  componentTitle: string,
  yaml: string
): string | null {
  if (isFeaturedId(componentId)) return null;
  if (!isPlatformComponentId(componentId) && IDENTITY_NAME_COMPONENTS.has(componentId))
    return null;
  const title = componentTitle.trim();
  if (!title) return null;

  // Names collide per platform (unlike globally-unique ids), so the
  // pool is scoped to the component's own top-level section.
  const existingNames = collectExistingNames(yaml, parseCatalogId(componentId).domain);
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
