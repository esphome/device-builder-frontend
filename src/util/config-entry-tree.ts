/**
 * Recursive walkers over a `ConfigEntry[]` tree: reveal advanced fields
 * under the caret and locate the first entry referenced by a
 * validation-error map.
 */

import type { ConfigEntry } from "../api/types/config-entries.js";
import { ConfigEntryType } from "../api/types/config-entries.js";
import type { ValidationError } from "./config-validation.js";

/** True when `entries` contains any advanced entry, recursively. Drives whether
 *  the advanced-settings control shows at all: a nested advanced field reveals
 *  in place (it can't move to the bottom section), so the control must surface
 *  even when no *top-level* unit is advanced, or the field is unreachable. */
export function anyAdvancedEntry(entries: ConfigEntry[]): boolean {
  for (const entry of entries) {
    if (entry.advanced) return true;
    if (
      entry.type === ConfigEntryType.NESTED &&
      anyAdvancedEntry(entry.config_entries ?? [])
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the entry at *path* — or any NESTED ancestor along it — is
 * `advanced`. Used to reveal a section's hidden advanced fields when the
 * caret follows to one. Returns false if the path doesn't resolve.
 */
export function pathIsAdvanced(entries: ConfigEntry[], path: string[]): boolean {
  let level = entries;
  let advanced = false;
  for (const key of path) {
    const entry = level.find((e) => e.key === key);
    if (!entry) return false;
    if (entry.advanced) advanced = true;
    level = entry.config_entries ?? [];
  }
  return advanced;
}

/**
 * Walk the entries in render order and return the first error target.
 * `path` is the dotted path of the failing leaf field;
 * `hasAdvancedAncestor` is true when the leaf itself or any
 * NESTED entry along the way is `advanced`.
 */
export function findFirstErrorTarget(
  entries: ConfigEntry[],
  errors: Map<string, ValidationError>,
  pathPrefix: string[] = [],
  ancestorAdvanced = false
): { path: string[]; hasAdvancedAncestor: boolean } | null {
  for (const entry of entries) {
    const path = [...pathPrefix, entry.key];
    const advancedHere = ancestorAdvanced || entry.advanced;
    if (entry.type === ConfigEntryType.NESTED) {
      const found = findFirstErrorTarget(
        entry.config_entries ?? [],
        errors,
        path,
        advancedHere
      );
      if (found) return found;
      continue;
    }
    if (errors.has(path.join("."))) {
      return { path, hasAdvancedAncestor: advancedHere };
    }
  }
  return null;
}
