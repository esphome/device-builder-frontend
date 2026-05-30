/**
 * Recursive walkers over a `ConfigEntry[]` tree. Used by the section
 * editor to (a) decide whether to show the "advanced" toggle, and
 * (b) locate the first entry referenced by a validation-error map.
 */

import type { ConfigEntry } from "../api/types.js";
import { ConfigEntryType } from "../api/types.js";
import type { ValidationError } from "./config-validation.js";

/**
 * Show-advanced decision for the automation action params form.
 *
 * When every entry is advanced (the `delay` action, for instance) the
 * form has no plain field to anchor it, so it's force-opened and the
 * toggle is suppressed. The mixed case shows the toggle and defers to
 * the user's `userShowAdvanced` choice — that's the path that makes
 * advanced fields like `logger.log`'s `args` reachable. With no
 * advanced entry there's nothing to gate.
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
