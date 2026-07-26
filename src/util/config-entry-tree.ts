/**
 * Recursive walkers over a `ConfigEntry[]` tree: reveal advanced fields
 * under the caret and locate the first entry referenced by a
 * validation-error map.
 */

import type { ConfigEntry } from "../api/types/config-entries.js";
import { ConfigEntryType } from "../api/types/config-entries.js";
import type { ValidationError } from "./config-validation.js";
import { isIndexSegment } from "./nested-values.js";
import { PIN_WIRING_KEYS } from "./pin/wiring-presets.js";

/** A pick-one group/cluster with any visible board-locked member is the
 *  board's choice: switching away would clear the locked value. Single
 *  source for the selector paint (dropdown/radios disable) and the
 *  add-form gate (the whole choice is non-actionable). */
export function choicePinned(
  members: ConfigEntry[],
  isVisible: (entry: ConfigEntry) => boolean = () => true
): boolean {
  return members.some((m) => m.locked && isVisible(m));
}

/** True when `entries` contains any advanced entry, recursively. Drives whether
 *  the advanced-settings control shows at all: a nested advanced field reveals
 *  in place (it can't move to the bottom section), so the control must surface
 *  even when no *top-level* unit is advanced, or the field is unreachable.
 *  Hidden entries never render, so they don't count. */
export function anyAdvancedEntry(entries: ConfigEntry[]): boolean {
  for (const entry of entries) {
    if (entry.hidden) continue;
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
 * caret or a backend error lands on one. List-index segments are skipped:
 * the schema nests an item's fields directly under the list entry, with
 * no index level. Returns false if the path doesn't resolve.
 */
export function pathIsAdvanced(entries: ConfigEntry[], path: string[]): boolean {
  let level = entries;
  let advanced = false;
  let prevWasPin = false;
  let inPinWiring = false;
  for (const key of path) {
    if (isIndexSegment(key)) continue;
    const entry = level.find((e) => e.key === key);
    if (!entry) return false;
    // A hidden entry never renders, so opening the advanced section
    // can't show it — don't reveal for one.
    if (entry.hidden) return false;
    // A pin's wiring section renders its fields regardless of the global
    // toggle, so advanced marks at or below the wiring keys don't gate
    // anything; keep walking so the hidden check above still covers the
    // rest of the path.
    if (prevWasPin && PIN_WIRING_KEYS.has(entry.key)) inPinWiring = true;
    if (entry.advanced && !inPinWiring) advanced = true;
    prevWasPin = entry.type === ConfigEntryType.PIN;
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
