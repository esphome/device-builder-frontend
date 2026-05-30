/**
 * Recursive walkers over a `ConfigEntry[]` tree. Used by the section
 * editor to (a) decide whether to show the "advanced" toggle, and
 * (b) locate the first entry referenced by a validation-error map.
 */

import type { ConfigEntry } from "../api/types.js";
import { ConfigEntryType } from "../api/types.js";
import type { ValidationError } from "./config-validation.js";

/**
 * Show-advanced state for the action params form. An all-advanced
 * action (e.g. `delay`) force-opens the form with no toggle; otherwise
 * the toggle shows and follows the user's choice.
 */
export function actionAdvancedState(
  entries: ConfigEntry[],
  userShowAdvanced: boolean
): { showAdvanced: boolean; showToggle: boolean } {
  const allAdvanced = entries.length > 0 && entries.every((e) => e.advanced);
  return {
    showAdvanced: allAdvanced || userShowAdvanced,
    showToggle: anyAdvancedEntry(entries) && !allAdvanced,
  };
}

/** True when `entries` contains any advanced entry, recursively. */
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
