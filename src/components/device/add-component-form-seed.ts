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
import { setIn } from "../../util/nested-values.js";

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
 * Walk the schema recursively to find the path of the first entry
 * with `references_component === domain`. Returns null if the
 * schema doesn't reference the domain — defensive against the
 * dialog passing a prefill that doesn't apply to this form.
 */
export function findReferencePath(
  entries: ConfigEntry[],
  domain: string,
  prefix: string[]
): string[] | null {
  for (const entry of entries) {
    if (entry.type === ConfigEntryType.NESTED) {
      const found = findReferencePath(entry.config_entries ?? [], domain, [
        ...prefix,
        entry.key,
      ]);
      if (found) return found;
      continue;
    }
    if (entry.references_component === domain) {
      return [...prefix, entry.key];
    }
  }
  return null;
}

/**
 * Seed an unlocked id-reference field with the matching component already in
 * the config, so a stale featured preset can't write an id that doesn't
 * exist. Ambiguous cases — none, several, or a `packages:`/`<<:` merge that
 * could hide one — stay unset, deferring to the dep detour or the picker.
 */
export function seedReference(yaml: string, domain: string): string | undefined {
  // Resolve against same-domain candidates only (i2c/spi/uart buses); the
  // picker also folds in async interface providers. A cross-domain ref finds
  // nothing here and defers to the picker; for a domain that is both a block
  // and a provided interface, seeding may fill a value the picker would call
  // ambiguous — harmless, since it's a real id the user can still change.
  const candidates = findReferenceCandidates(yaml, domain, []);
  return resolveSoleCandidate(candidates, yaml)?.id;
}

/**
 * Seed initial form values. By default only required fields' defaults
 * are pre-filled — pre-filling optional fields the user can't see
 * would just bloat the payload with values they never explicitly
 * chose. NESTED entries recurse regardless of whether the parent is
 * required, since a non-required group can still contain required
 * descendants we want to seed.
 *
 * When `seedAll` is true, every entry with a non-null `default_value`
 * is seeded — used for featured components so backend-baked presets
 * land in the payload even on optional fields.
 */
export function seedDefaults(
  entries: ConfigEntry[],
  yaml: string,
  localize: LocalizeFunc,
  seedAll: boolean = false
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of entries) {
    if (entry.type === ConfigEntryType.NESTED) {
      const sub = seedDefaults(entry.config_entries ?? [], yaml, localize, seedAll);
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
    if (!seedAll && !entry.required) continue;
    // Resolve an id reference against the live YAML so a stale featured
    // preset (`i2c_bus`) can't outlive the bus it names. Locked refs are
    // deliberate pins — keep their literal.
    if (entry.references_component && !entry.locked) {
      const ref = seedReference(yaml, entry.references_component);
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
  // backend-baked presets in `default_value` for arbitrary fields,
  // not just required ones. Seed every entry with a non-null default
  // when filling a featured entry so a board-pinned (locked) optional
  // field actually emits its preset on submit — otherwise the
  // backend's locked-validation would reject the empty payload.
  const seedAll = isFeaturedId(component.id);
  let next = seedDefaults(entries, yaml, localize, seedAll);

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
    const targetPath = findReferencePath(entries, prefillReference.domain, []);
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
