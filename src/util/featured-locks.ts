/**
 * Value-dependent board-lock overlay for a section instance.
 *
 * The add dialog receives ``locked`` on the server-hydrated featured
 * entries, but the editor renders the plain component schema, so a
 * board-locked preset (the ESK-1 module's ``num_leds``) arrived
 * editable there. Overlay ``locked`` onto entries whose instance still
 * sits on the locked preset — matched to the featured entry by the
 * instance's ``id``, and released once the user moves the value off
 * the preset in YAML (their own config, like the pin guard). A mapping
 * preset (ethernet's ``clk: {pin, mode}``) descends into the nested
 * group's children, locking each leaf still on its preset value.
 */

import type { BoardCatalogEntry } from "../api/types/boards.js";
import type { ConfigEntry } from "../api/types/config-entries.js";
import { ConfigEntryType } from "../api/types/config-entries.js";
import type { LockedReasonCarrier } from "../components/device/config-entry-renderers-shared.js";
import { featuredEntryForInstance } from "./featured-id.js";
import { isPlainObject } from "./nested-values.js";

// Stable locked copies so re-renders hand the form identical entry
// references (same rationale as the pin wiring's lock cache). A nested
// copy stays valid while its children are identical, which the child
// caches make an identity check.
const lockedCopies = new WeakMap<ConfigEntry, ConfigEntry>();
const nestedCopies = new WeakMap<ConfigEntry, ConfigEntry>();
// Catalog-drift warnings fire once per schema entry, not per render.
const warnedDrift = new WeakSet<ConfigEntry>();

export function overlayBoardLockedPresets(
  entries: ConfigEntry[],
  board: BoardCatalogEntry | null,
  sectionKey: string,
  values: Record<string, unknown>
): ConfigEntry[] {
  const fc = featuredEntryForInstance(board, sectionKey, values.id);
  if (!fc) return entries;
  let changed = false;
  const mapped = entries.map((entry) => {
    const preset = fc.fields[entry.key];
    if (!preset?.locked) return entry;
    const out = overlayEntry(entry, preset.value, values[entry.key]);
    if (out !== entry) changed = true;
    return out;
  });
  return changed ? mapped : entries;
}

/** Locked copy of *entry* while *current* still sits on the locked
 *  *preset*, descending mapping presets into nested children. Pins keep
 *  their own value-dependent guard (the picker's board-preset lock);
 *  stamping ``locked`` would demote it to the hard-lock chrome and hide
 *  the wiring guard row. An already-locked entry (the add dialog's
 *  server-hydrated featured schema) keeps its own lock and reason
 *  verbatim. */
function overlayEntry(
  entry: ConfigEntry,
  preset: unknown,
  current: unknown
): ConfigEntry {
  if (entry.locked || entry.type === ConfigEntryType.PIN) return entry;
  if (isPlainObject(preset)) {
    const children = entry.config_entries;
    if (!children) {
      // A mapping preset over a leaf entry is catalog/schema drift: the
      // board's lock can't apply, so surface it instead of silently
      // rendering the field editable.
      if (!warnedDrift.has(entry)) {
        warnedDrift.add(entry);
        console.warn(
          `Board mapping preset for '${entry.key}' has no nested schema entries; lock not applied`
        );
      }
      return entry;
    }
    if (!isPlainObject(current)) return entry;
    let changed = false;
    const mapped = children.map((child) => {
      if (!(child.key in preset)) return child;
      const out = overlayEntry(child, preset[child.key], current[child.key]);
      if (out !== child) changed = true;
      return out;
    });
    return changed ? nestedCopy(entry, mapped) : entry;
  }
  return presetValueMatches(current, preset) ? lockedCopy(entry) : entry;
}

function lockedCopy(entry: ConfigEntry): ConfigEntry {
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
}

function nestedCopy(entry: ConfigEntry, children: ConfigEntry[]): ConfigEntry {
  const hit = nestedCopies.get(entry);
  if (hit && children.every((child, i) => child === hit.config_entries![i])) {
    return hit;
  }
  const copy = { ...entry, config_entries: children };
  nestedCopies.set(entry, copy);
  return copy;
}

/** Loose scalar match (YAML round-trips ``48`` and ``"48"``); lists via
 *  JSON. A mapping preset never reaches here — ``overlayEntry`` descends
 *  it — so an object on either side means a shape mismatch. */
function presetValueMatches(current: unknown, preset: unknown): boolean {
  if (current === undefined || current === null || preset === null) return false;
  if (Array.isArray(preset) || Array.isArray(current)) {
    return JSON.stringify(current) === JSON.stringify(preset);
  }
  if (typeof preset === "object" || typeof current === "object") return false;
  return String(current) === String(preset);
}
