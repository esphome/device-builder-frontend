/**
 * Pure helpers for ``<esphome-registry-list>`` (the
 * ``ConfigEntryType.REGISTRY_LIST`` renderer, #941): polymorphic-list
 * item inspection, the per-registry ops table, and the splice logic
 * that preserves foreign entries through visual edits. Extracted from
 * ``registry-list.ts`` so the element file stays under the size cap and
 * these context-free functions can be reasoned about (and tested) on
 * their own.
 */
import type { ESPHomeAPI } from "../../../api/esphome-api.js";
import type {
  RegistryCatalogEntry,
  RegistryValueType,
} from "../../../api/types/automations.js";
import { ConfigEntryType } from "../../../api/types/config-entries.js";
import {
  fetchFilters,
  fetchLightEffects,
  getCachedFilters,
  getCachedLightEffects,
} from "../../../util/automation-catalog-cache.js";

/** Extract the single key from a polymorphic-list item. Items
 *  arriving from a freshly-pressed Add button can be ``{}`` until
 *  the user picks a type. Items with more than one key are
 *  malformed (the registry contract is one key per item); return
 *  the empty string and let the row render with a placeholder so
 *  the user notices and the next save doesn't silently truncate. */
export function itemId(item: Record<string, unknown>): string {
  const keys = Object.keys(item);
  return keys.length === 1 ? keys[0] : "";
}

/** True when *item* looks like a registry-list item the renderer can
 *  edit: a plain object with zero or one key. Multi-key items or
 *  non-object entries are preserved verbatim through edits via
 *  ``preserveForeignEntries`` so a click in the visual editor never
 *  drops data the form doesn't understand. */
export function isEditableItem(raw: unknown): raw is Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  return Object.keys(raw as Record<string, unknown>).length <= 1;
}

/** Per-row label for the type picker. The catalog stores names
 *  with a redundant ``Domain → Name`` prefix (useful in the
 *  cross-domain automation editor; noise in a single-domain
 *  picker). Titlecase the id directly so the row reads as the
 *  user typed it in YAML. Unknown ids (legacy configs) fall
 *  through to the raw id. */
export function formatRegistryId(id: string): string {
  if (!id) return "";
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Cache + fetch pair for one named registry, plus the rule that
 *  scopes ``applies_to`` against the section being edited.
 *
 *  ``filter`` (sensor / binary_sensor / text_sensor filters)
 *  applies_to is the bare domain (``"sensor"`` etc.) so we match
 *  on the section's first dotted segment. ``light_effects``
 *  applies_to lists qualified component ids
 *  (``"light.esp32_rmt_led_strip"``), so we match on the whole
 *  section key. */
export interface RegistryOps {
  cache: () => RegistryCatalogEntry[] | undefined;
  fetch: (api: ESPHomeAPI) => Promise<unknown>;
  /** Project a section key (``light.esp32_rmt_led_strip``) into the
   *  shape ``applies_to`` lists use for this registry. */
  parentToken: (sectionKey: string) => string;
  /** True when the picker should hide ids already chosen by other
   *  rows. Set for registries where the row's *type id* doubles as
   *  the entry's identifier on the compile side and a per-row
   *  ``name:`` override isn't available in the visual editor yet —
   *  ``light_effects`` is the only such case today (each effect's
   *  default ``name:`` is derived from the effect id, so two rows
   *  with the same id collide as ``Found the effect name 'X' twice``).
   *  For registries like ``filter`` where chained same-type entries
   *  with different params is a normal pattern (``- delta: 0.5`` +
   *  ``- delta: 1.0``), leave false so the visual editor matches
   *  YAML expressiveness. */
  dedupByTypeId: boolean;
}

/** Map a registry entry's ``value_type`` (time_period / float /
 *  integer / string / lambda) to the ConfigEntryType the per-field
 *  renderer dispatch knows. The registry-list sub-form constructs a
 *  synthetic ConfigEntry of the matching type and routes through
 *  ``ctx.renderEntry`` so each scalar shape reuses the same input
 *  widget the regular form does. */
export const VALUE_TYPE_TO_CONFIG_TYPE: Record<RegistryValueType, ConfigEntryType> = {
  time_period: ConfigEntryType.TIME_PERIOD,
  float: ConfigEntryType.FLOAT,
  integer: ConfigEntryType.INTEGER,
  string: ConfigEntryType.STRING,
  lambda: ConfigEntryType.LAMBDA,
};

export const REGISTRY_OPS: Record<string, RegistryOps> = {
  light_effects: {
    cache: () => getCachedLightEffects(),
    fetch: (api) => fetchLightEffects(api),
    parentToken: (sectionKey) => sectionKey,
    dedupByTypeId: true,
  },
  filter: {
    cache: () => getCachedFilters(),
    fetch: (api) => fetchFilters(api),
    parentToken: (sectionKey) => sectionKey.split(".", 1)[0],
    dedupByTypeId: false,
  },
};

/** Coerce ``ctx.getAt`` output to the raw list of mixed entries.
 *  Anything that isn't already an array (a freshly-mounted form with
 *  no value, a parser fallback to YamlRawValue) renders as an empty
 *  list — the user can click Add to start. The renderer treats
 *  non-object / multi-key entries as foreign and preserves them
 *  verbatim through edits via :func:`spliceEditable`. */
export function asList(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

/** Editable items + their positions in the original list. Foreign
 *  entries (non-object or multi-key) stay in the list but the
 *  picker doesn't render rows for them; ``spliceEditable`` glues
 *  the edited slice back into the original positions on save. */
export function editableEntries(list: unknown[]): {
  items: Record<string, unknown>[];
  positions: number[];
} {
  const items: Record<string, unknown>[] = [];
  const positions: number[] = [];
  list.forEach((it, i) => {
    if (isEditableItem(it)) {
      items.push(it);
      positions.push(i);
    }
  });
  return { items, positions };
}

/** Re-emit *list* with the editable slice replaced by *next*. Foreign
 *  entries keep their original positions; new entries from Add land
 *  at the end of the editable slice (just before any trailing
 *  foreign entries). */
export function spliceEditable(
  list: unknown[],
  positions: number[],
  next: Record<string, unknown>[]
): unknown[] {
  const out: unknown[] = [...list];
  // Replace each tracked editable slot, drop the trailing tail when
  // ``next`` is shorter (Remove), append when longer (Add).
  positions.forEach((pos, i) => {
    if (i < next.length) out[pos] = next[i];
  });
  if (next.length < positions.length) {
    // Remove the surplus tracked slots in descending order so earlier
    // indices stay valid as we splice.
    const removeAt = positions.slice(next.length).reverse();
    for (const pos of removeAt) out.splice(pos, 1);
  } else if (next.length > positions.length) {
    // Add: insert new entries immediately after the last editable
    // slot, preserving any foreign entries that came after.
    const insertAt =
      positions.length > 0 ? positions[positions.length - 1] + 1 : out.length;
    out.splice(insertAt, 0, ...next.slice(positions.length));
  }
  return out;
}
