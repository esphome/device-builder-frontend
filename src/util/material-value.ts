/** "Has the user set a value here?" — the visibility half of the
 *  advanced/hidden gating rules, shared by the render filter and the
 *  caret-follow reveal. */

import type { ConfigEntry } from "../api/types/config-entries.js";
import { ConfigEntryType } from "../api/types/config-entries.js";
import { isPlainObject } from "./nested-values.js";
import { YamlRawValue } from "./yaml-serialize.js";

/**
 * True when ``entry`` carries a value the user has set (typically
 * loaded from YAML). For leaves, any non-``undefined`` value counts
 * — the YAML parser only adds a key to ``values`` when it's
 * actually present in the document, so "present in ``values``"
 * is the visibility signal we want. Note this is a visibility
 * predicate, not a serialization predicate: an explicit empty
 * scalar (``key: ""``) or null may render once and then be
 * dropped on save by ``serializeYamlValues``, which is fine —
 * the next reload will hide the field.
 *
 * For NESTED entries, recurse into the sub-dict and report true if
 * any descendant leaf is set; an advanced group with at least one
 * filled child needs to render so the child is reachable.
 */
export function hasMaterialValue(
  entry: ConfigEntry,
  values: Record<string, unknown>
): boolean {
  const value = values[entry.key];
  if (entry.type === ConfigEntryType.NESTED) {
    if (entry.multi_value) {
      // Repeatable nested mapping (``esphome.devices`` /
      // ``esphome.areas``): any non-empty array of items counts.
      // We don't recurse — items are user-added, and a freshly
      // added empty ``{}`` still represents user intent (the row
      // exists because they clicked Add). A ``YamlRawValue`` at
      // this key (the parser preserved the block byte-for-byte
      // because the items didn't fit the flat-mapping contract)
      // also counts — the user's YAML must keep showing without
      // a trip through the Advanced toggle.
      if (value instanceof YamlRawValue) return true;
      return Array.isArray(value) && value.length > 0;
    }
    // A scalar at a NESTED key is a shorthand the user set in YAML (e.g.
    // a pin ``mode: OUTPUT``); it's material even though it can't recurse.
    if (!isPlainObject(value)) return value !== undefined;
    return (entry.config_entries ?? []).some((child) => hasMaterialValue(child, value));
  }
  return value !== undefined;
}
