import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { ComponentCatalogEntry } from "../../api/types/components.js";
import type { ConfigEntry } from "../../api/types/config-entries.js";
import { ConfigEntryType } from "../../api/types/config-entries.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { seedBoardPinDefaults } from "../../util/board-pin-defaults.js";
import {
  findReferenceCandidates,
  resolveSoleCandidate,
} from "../../util/config-entry-yaml-scan.js";
import {
  collectExistingIds,
  generateDefaultComponentId,
} from "../../util/default-component-id.js";
import { resolveEntryLabel } from "../../util/entry-label.js";
import { isFeaturedId } from "../../util/featured-id.js";
import { getIn, setIn } from "../../util/nested-values.js";

/** Inputs the seeding pipeline reads off the host component. */
export interface SeedContext {
  /** Schema entries after required/option overlays are applied. */
  entries: ConfigEntry[];
  component: ComponentCatalogEntry;
  board: BoardCatalogEntry | null;
  yaml: string;
  prefillReference: { domain: string; id: string } | null;
  prefillFields: Record<string, unknown> | null;
  /** Values the user had entered before a "+ Add <dep>" detour, restored on
   *  return so a field they already filled (e.g. an SPI device's `cs_pin`)
   *  isn't lost. Overlaid before `prefillReference` so the just-added dep's id
   *  still wins for the reference field. */
  restoredValues: Record<string, unknown> | null;
  localize: LocalizeFunc;
}

/**
 * Walk the schema recursively for the path of the first
 * `references_component === domain` entry that `seeded` has not already
 * filled. Returns null when the schema references no such unfilled field —
 * defensive against a prefill that doesn't apply, and so a chained prefill
 * lands on a still-empty reference instead of overwriting a seeded one.
 */
export function findReferencePath(
  entries: ConfigEntry[],
  domain: string,
  prefix: string[],
  seeded: Record<string, unknown> = {}
): string[] | null {
  for (const entry of entries) {
    if (entry.type === ConfigEntryType.NESTED) {
      const found = findReferencePath(
        entry.config_entries ?? [],
        domain,
        [...prefix, entry.key],
        seeded
      );
      if (found) return found;
      continue;
    }
    if (entry.references_component === domain) {
      const path = [...prefix, entry.key];
      // Skip a field seedDefaults already filled (from its preset or the sole
      // candidate) so the chained prefill can't overwrite it; a reference
      // seedDefaults left empty (a stale or ambiguous preset) still takes the
      // prefill rather than being stranded.
      if (getIn(seeded, path) !== undefined) continue;
      return path;
    }
  }
  return null;
}

/**
 * Seed initial form values. By default only required fields' defaults
 * are pre-filled — pre-filling optional fields the user can't see
 * would just bloat the payload with values they never explicitly
 * chose. NESTED entries recurse regardless of whether the parent is
 * required, since a non-required group can still contain required
 * descendants we want to seed.
 *
 * When `seedPresets` is true (featured components), optional entries
 * flagged `from_preset` are seeded too, so backend-baked presets land in
 * the payload. Plain catalog defaults stay unseeded so a featured add
 * emits only the preset fields — matching the create-time auto-add and
 * avoiding phantom-touched optional groups (e.g. `manual_ip`).
 */
export function seedDefaults(
  entries: ConfigEntry[],
  yaml: string,
  localize: LocalizeFunc,
  seedPresets: boolean = false
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of entries) {
    if (entry.type === ConfigEntryType.NESTED) {
      const sub = seedDefaults(entry.config_entries ?? [], yaml, localize, seedPresets);
      // A required entity sub-reading (ags10's tvoc) serializes only
      // once it holds a value; seed its name (the label) so an
      // untouched Add still produces a valid sensor, matching the
      // optional-entity enable toggle.
      if (
        entry.required &&
        entry.platform_type != null &&
        sub.name === undefined &&
        sub.id === undefined
      ) {
        sub.name = resolveEntryLabel(entry, localize);
      }
      if (Object.keys(sub).length > 0) out[entry.key] = sub;
      continue;
    }
    if (!entry.required && !(seedPresets && entry.from_preset)) continue;
    // Resolve an id reference against the live YAML so a stale featured
    // preset (`i2c_bus`) can't outlive the bus it names. Locked refs are
    // deliberate pins — keep their literal.
    if (entry.references_component && !entry.locked) {
      const candidates = findReferenceCandidates(yaml, entry.references_component, []);
      // A featured preset that names a component actually present in the live
      // config (a sibling just added in the same bundle, e.g. `output_blue`)
      // wins — `resolveSoleCandidate` can't pick among several same-domain
      // candidates, but the per-field preset already says which one. Check
      // membership so a stale preset that outlived its target still defers.
      const presetId =
        seedPresets &&
        entry.from_preset &&
        typeof entry.default_value === "string" &&
        candidates.some((c) => c.id === entry.default_value)
          ? entry.default_value
          : undefined;
      const ref = presetId ?? resolveSoleCandidate(candidates, yaml)?.id;
      if (ref !== undefined) {
        out[entry.key] = entry.multi_value ? [ref] : ref;
      } else if (entry.multi_value && entry.required) {
        out[entry.key] = [];
      }
      continue;
    }
    if (entry.default_value != null) {
      out[entry.key] = entry.multi_value
        ? [String(entry.default_value)]
        : entry.default_value;
    } else if (entry.multi_value && entry.required) {
      out[entry.key] = [];
    }
  }
  return out;
}

/**
 * Build the initial form `_values` for the current component:
 *  1. Seed required entries' default values (recursively).
 *  2. Auto-generate a unique `id` for the top-level id field.
 *  3. Seed pin entries from the board manifest.
 *  4. Restore the values the user typed before a "+ Add <dep>" detour
 *     (over the seeded defaults, under the prefills below).
 *  5. If we were just brought back from a "+ Add <domain>" detour,
 *     prefill the field that points at that domain with the new id.
 *  6. Overlay constraint-derived prefill fields last.
 */
export function buildInitialValues(ctx: SeedContext): Record<string, unknown> {
  const {
    entries,
    component,
    board,
    yaml,
    prefillReference,
    prefillFields,
    restoredValues,
    localize,
  } = ctx;

  // Featured-component entries (ids prefixed with `featured.`) carry
  // backend-baked presets on arbitrary fields, not just required ones.
  // Seed those `from_preset` fields so a board-pinned (locked) optional
  // field still emits its preset on submit — otherwise the backend's
  // locked-validation would reject the empty payload. Plain catalog
  // defaults stay unseeded so the add matches the create-time auto-add.
  const seedPresets = isFeaturedId(component.id);
  // Snapshot what seeding owns so a later prefill skips exactly those refs
  // (not every preset-flagged one), without treating a restored value as seeded.
  const seededDefaults = seedDefaults(entries, yaml, localize, seedPresets);
  let next = seededDefaults;

  const idEntry = entries.find((e) => e.key === "id" && e.type === ConfigEntryType.ID);
  if (idEntry && next["id"] === undefined) {
    const seeded = generateDefaultComponentId(
      component.id,
      component.multi_conf,
      collectExistingIds(yaml)
    );
    if (seeded !== null) next = { ...next, id: seeded };
  }

  // Seed pin entries from the board's manifest when the board has
  // a pin tagged with the matching peripheral feature. Without this,
  // ESPHome falls back to its compile-time defaults — which on the
  // ESP32-C3 (and other variants without an SCL/SDA alias) are
  // either invalid or wrong-numbered: i2c on C3 emits an
  // "Invalid pin number: 22" squiggle because the bus block
  // falls back to ESP32 GPIO22/21.
  next = seedBoardPinDefaults(component.id, entries, board, next);

  // Restore what the user typed before a "+ Add <dep>" detour, over the freshly
  // seeded defaults, but before `prefillReference` so the just-added dep's id
  // still wins for the reference field.
  if (restoredValues) {
    next = { ...next, ...restoredValues };
  }

  if (prefillReference) {
    const targetPath = findReferencePath(
      entries,
      prefillReference.domain,
      [],
      seededDefaults
    );
    if (targetPath) {
      next = setIn(next, targetPath, prefillReference.id);
    }
  }

  // Last so a constraint-derived value beats the bare catalog default.
  if (prefillFields) {
    next = { ...next, ...prefillFields };
  }

  return next;
}
