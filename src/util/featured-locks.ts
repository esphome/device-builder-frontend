/**
 * Value-dependent board-lock overlay for a section instance.
 *
 * The add dialog receives ``locked`` on the server-hydrated featured
 * entries, but the editor renders the plain component schema, so a
 * board-locked preset (the ESK-1 module's ``num_leds``) arrived
 * editable there. Overlay ``locked`` onto entries whose instance still
 * sits on the locked preset — matched to the featured entry by the
 * instance's ``id``, and released once the user moves the value off
 * the preset in YAML (their own config, like the pin guard).
 */

import type { BoardCatalogEntry } from "../api/types/boards.js";
import type { ConfigEntry } from "../api/types/config-entries.js";
import { ConfigEntryType } from "../api/types/config-entries.js";
import type { LockedReasonCarrier } from "../components/device/config-entry-renderers-shared.js";
import { featuredEntryForInstance } from "./featured-id.js";

// Stable locked copies so re-renders hand the form identical entry
// references (same rationale as the pin wiring's lock cache).
const lockedCopies = new WeakMap<ConfigEntry, ConfigEntry>();

export function overlayBoardLockedPresets(
  entries: ConfigEntry[],
  board: BoardCatalogEntry | null,
  sectionKey: string,
  values: Record<string, unknown>
): ConfigEntry[] {
  const lockedKeys = boardLockedPresetKeys(board, sectionKey, values);
  if (lockedKeys.size === 0) return entries;
  return entries.map((entry) => {
    // Pins keep their own value-dependent guard (the picker's
    // board-preset lock); stamping ``locked`` would demote it to the
    // hard-lock chrome and hide the wiring guard row. An already-locked
    // entry (the add dialog's server-hydrated featured schema) keeps its
    // own lock and reason verbatim.
    if (
      !lockedKeys.has(entry.key) ||
      entry.locked ||
      entry.type === ConfigEntryType.PIN
    ) {
      return entry;
    }
    let copy = lockedCopies.get(entry);
    if (!copy) {
      copy = {
        ...entry,
        locked: true,
        locked_reason_key: "device.pin_wiring_guard_tooltip",
      } as ConfigEntry & LockedReasonCarrier;
      lockedCopies.set(entry, copy);
    }
    return copy;
  });
}

/** Keys of *sectionKey*'s board-locked presets the instance in *values*
 *  still holds, matched to the featured entry by its ``id`` preset. */
function boardLockedPresetKeys(
  board: BoardCatalogEntry | null,
  sectionKey: string,
  values: Record<string, unknown>
): Set<string> {
  const out = new Set<string>();
  const fc = featuredEntryForInstance(board, sectionKey, values.id);
  if (!fc) return out;
  for (const [key, preset] of Object.entries(fc.fields)) {
    if (preset.locked && presetValueMatches(values[key], preset.value)) {
      out.add(key);
    }
  }
  return out;
}

/** Loose scalar match (YAML round-trips ``48`` and ``"48"``); lists via
 *  JSON. Mapping presets never match — their only locked use is pins,
 *  which the overlay skips anyway. */
function presetValueMatches(current: unknown, preset: unknown): boolean {
  if (current === undefined || current === null || preset === null) return false;
  if (Array.isArray(preset) || Array.isArray(current)) {
    return JSON.stringify(current) === JSON.stringify(preset);
  }
  if (typeof preset === "object" || typeof current === "object") return false;
  return String(current) === String(preset);
}
