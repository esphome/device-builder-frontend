import type { ESPHomeAPI } from "../../api/index.js";
import type { FeaturedComponent } from "../../api/types/boards.js";
import type { ComponentCatalogEntry } from "../../api/types/components.js";
import {
  busConstraintPrefill,
  type BusPrefill,
} from "../../util/bus-constraint-prefill.js";
import { fetchComponent } from "../../util/component-name-cache.js";

/** One suspended level of a "+ Add <dep>" detour. */
export interface DetourFrame {
  component: ComponentCatalogEntry;
  depDomain: string;
  values: Record<string, unknown> | null;
  prefill: BusPrefill | null;
}

/** Slice of ``ESPHomeAddComponentDialog`` state a suspended level restores into. */
export interface DetourHost {
  _selected: ComponentCatalogEntry | null;
  _detourStack: DetourFrame[];
  _returnValues: Record<string, unknown> | null;
  _depPrefill: BusPrefill | null;
}

/** Slice of ``ESPHomeAddComponentDialog`` state ``navigateToDep`` reads / writes. */
export interface DepNavHost extends DetourHost {
  readonly _api: ESPHomeAPI;
  platform: string;
  board: { id: string; featured_components?: FeaturedComponent[] } | null;
  _catalog: { filterByDomain(domain: string): void } | null;
  _submitError: string;
  _submitting: boolean;
  _depNavSeq: number;
  readonly updateComplete: Promise<boolean>;
}

/**
 * Open the form for a missing dependency. Exact-id deps (``i2c``,
 * ``uart``) retarget directly; the catalog's fuzzy search would
 * rank every sensor mentioning the bus name above the bus entry.
 * Domain-level deps (``output``, ``sensor``) fall back to the
 * category-filtered catalog where the user picks a variant.
 *
 * ``values`` is the requesting form's in-progress input, parked on the
 * suspended level's frame until it is popped.
 */
export async function navigateToDep(
  host: DepNavHost,
  domain: string,
  values: Record<string, unknown> | null = null
): Promise<void> {
  if (host._submitting) return;
  // Snapshot, don't commit, until the lookup resolves: the original
  // form is still rendered + submit-enabled (request-add-component
  // path), so a pushed frame would mislead _onFormSubmit.
  const previousSelected = host._selected;
  host._submitError = "";
  const seq = ++host._depNavSeq;
  let direct: ComponentCatalogEntry | null = null;
  try {
    direct = await fetchComponent(
      host._api,
      domain,
      host.platform || undefined,
      host.board?.id ?? undefined
    );
  } catch {
    direct = null;
  }
  if (seq !== host._depNavSeq) return;
  if (previousSelected) {
    host._detourStack = [
      ...host._detourStack,
      {
        component: previousSelected,
        depDomain: domain,
        values,
        prefill: host._depPrefill,
      },
    ];
  }
  // The suspended level's prefill rides its frame from here; leaving it set
  // would seed the catalog-fallback pick with the requester's bus values.
  host._depPrefill = null;
  if (direct) {
    // The requester's bus constraints become the new bus's starting
    // values (ags10 caps i2c at 15kHz, most uart devices pin a baud).
    const constraints = previousSelected?.bus_constraints?.[domain];
    const busPrefill = constraints
      ? busConstraintPrefill(direct.config_entries, constraints)
      : null;
    // First match wins: the detour knows only the dependency's component_id,
    // not a specific featured id, so it can't disambiguate a board that lists
    // the same hub component twice with diverging locked pins. The importer
    // never produces that (it skips multi-hub configs), so only a hand-curated
    // board could reach it.
    const fc = host.board?.featured_components?.find((c) => c.component_id === direct.id);
    host._depPrefill = mergePrefill(busPrefill, featuredHubPrefill(fc));
    // Carry the featured entry's locked state too, not just its values, so a
    // hub reached through the detour matches the direct featured pick (a pin
    // the catalog locks renders disabled, never editable into a config the
    // backend would reject).
    host._selected = fc ? applyFeaturedLocks(direct, fc) : direct;
    return;
  }
  host._selected = null;
  await host.updateComplete;
  if (seq !== host._depNavSeq) return;
  host._catalog?.filterByDomain(domain);
}

/** Unwind one level, restoring its component, values and prefill; null when empty. */
export function popDetour(host: DetourHost): DetourFrame | null {
  const frame = host._detourStack[host._detourStack.length - 1];
  if (!frame) return null;
  host._detourStack = host._detourStack.slice(0, -1);
  host._selected = frame.component;
  host._returnValues = frame.values;
  // `prefillFields` is merged after `restoredValues` in the seed, so a restored
  // level keeps the prefill's required / option constraints but drops its
  // values — the snapshot already carries them, edits included.
  host._depPrefill =
    frame.values && frame.prefill ? { ...frame.prefill, fields: {} } : frame.prefill;
  return frame;
}

/**
 * Starting values for a dependency that a board featured-component
 * materializes (e.g. a bp5758d / sm2135 LED-driver hub with locked
 * clock_pin / data_pin). The `requires` prerequisite flow only pre-fills the
 * hub when the user picks the featured consumer directly; reaching the hub
 * through the missing-dependency detour (or a full-setup bundle, which doesn't
 * re-resolve a queued member's `requires`) lands here instead — so apply the
 * same preset values the baked `featured.<board>.<id>` would, rather than an
 * empty form. Returns null when no featured entry materializes this component.
 */
function featuredHubPrefill(fc: FeaturedComponent | undefined): BusPrefill | null {
  if (!fc) return null;
  const fields: Record<string, unknown> = {};
  for (const [key, preset] of Object.entries(fc.fields)) {
    if (preset.value !== null && preset.value !== undefined) fields[key] = preset.value;
  }
  return Object.keys(fields).length > 0 ? { fields, required: [] } : null;
}

/**
 * Clone *direct* with ``locked: true`` on each config entry the featured entry
 * locks, so the dep form disables those fields (``effectiveDisabled`` reads
 * ``entry.locked``). The bare component fetched for the detour carries no lock
 * flags — only the server-hydrated ``featured.<board>.<id>`` does — so without
 * this the pins arrive pre-filled but editable. Returns *direct* untouched when
 * nothing is locked; never mutates the cached component.
 */
function applyFeaturedLocks(
  direct: ComponentCatalogEntry,
  fc: FeaturedComponent
): ComponentCatalogEntry {
  const lockedKeys = new Set(
    Object.entries(fc.fields)
      .filter(([, preset]) => preset.locked)
      .map(([key]) => key)
  );
  if (lockedKeys.size === 0) return direct;
  return {
    ...direct,
    config_entries: direct.config_entries.map((entry) =>
      lockedKeys.has(entry.key) ? { ...entry, locked: true } : entry
    ),
  };
}

/** Merge a bus-constraint prefill with a featured one; the bus wins a shared field. */
function mergePrefill(
  bus: BusPrefill | null,
  featured: BusPrefill | null
): BusPrefill | null {
  if (!bus) return featured;
  if (!featured) return bus;
  return {
    fields: { ...featured.fields, ...bus.fields },
    required: [...bus.required, ...featured.required],
    ...(bus.optionOverrides ? { optionOverrides: bus.optionOverrides } : {}),
  };
}

/**
 * True when *added* is the component the user navigated to via
 * ``navigateToDep(depDomain)`` — matching by exact id for top-level
 * deps (``i2c``) or by category for domain-level deps (``output``).
 */
export function matchesDepDomain(
  added: ComponentCatalogEntry,
  depDomain: string
): boolean {
  return added.id === depDomain || added.category === depDomain;
}
