import memoizeOne from "memoize-one";
import type { FeaturedBundle, FeaturedComponent } from "../../../api/types/boards.js";
import {
  type ComponentCatalogEntry,
  ComponentCategory,
} from "../../../api/types/components.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { isComponentPresent } from "../../../util/component-presence.js";
import { platformSupported } from "../../../util/config-validation.js";
import { collectExistingIds } from "../../../util/default-component-id.js";
import { buildFeaturedId } from "../../../util/featured-id.js";
import {
  parseConfiguredPlatforms,
  parseTopLevelComponents,
} from "../../../util/yaml-serialize.js";
import { categoryChipLabel } from "../component-card-category-label.js";
import type { ESPHomeComponentCatalog } from "../component-catalog.js";

// The catalog re-renders on every search keystroke, and visibleComponents +
// availableFeaturedCount each scan the YAML, so the same string is parsed
// several times per render. memoize-one caches the last result per scan; its
// single slot fits one open catalog at a time (the catalog is a dialog).
const memoPresent = memoizeOne(parseTopLevelComponents);
const memoPlatforms = memoizeOne(parseConfiguredPlatforms);
const memoIds = memoizeOne(collectExistingIds);

// Three filters applied client-side:
//  1. Platform gate: drop components incompatible with the device's
//     platform (e.g. bk72xx on an esp32 board). The backend filters too
//     when it receives `platform`, but the fetch fires once on open and
//     can race the board resolving with an empty platform; this re-applies
//     the gate on every render once `host.platform` settles. Applied first
//     so the core dependency-satisfaction set below only counts components
//     that survive the gate.
//  2. Single-instance components already in the YAML get hidden.
//     - bare top-level (`web_server`, `wifi`) → match presence of `<id>:`
//     - platform variant (`time.homeassistant`) → match `<domain>.<platform>`
//     Multi-conf components always stay visible. Featured entries carry a
//     synthetic `featured.<board>.<localId>` id, so match them by their
//     underlying `component_id` (e.g. an Onboard Ethernet card → `ethernet`).
//  3. Core-locked: drop platform variants whose dependencies can't be
//     satisfied from this dialog. A dep counts as satisfied when it's
//     already in the user's YAML OR one of the platform-compatible IDs in
//     this response.
// A featured card pins a specific board peripheral via a preset `id`
// (apollo `rgb_leds`). Once that id is in the YAML the peripheral is
// configured, so the card is effectively single-instance even when its
// underlying type is multi_conf (many LED strips exist, but only one exists on the board).
function featuredIdPresent(
  fc: FeaturedComponent,
  existingIds: ReadonlySet<string>
): boolean {
  const presetId = fc.fields?.["id"]?.value;
  return typeof presetId === "string" && existingIds.has(presetId);
}

export function visibleComponents(
  host: ESPHomeComponentCatalog
): ComponentCatalogEntry[] {
  const present = memoPresent(host.yaml);
  const presentPlatforms = memoPlatforms(host.yaml);
  const lockedToCore = host.lockedCategories.length > 0;
  const platformCompatible = host._components.filter((c) =>
    platformSupported(c.supported_platforms, host.platform)
  );
  const coreCompatible = lockedToCore
    ? new Set(platformCompatible.map((c) => c.id))
    : null;

  // Map a featured card's synthetic id back to its FeaturedComponent.
  const featuredById = new Map<string, FeaturedComponent>();
  const board = host.board;
  if (board) {
    // Slim board entries omit featured_components; guard like the catalog's load().
    for (const fc of board.featured_components ?? []) {
      featuredById.set(buildFeaturedId(board.id, fc.id), fc);
    }
  }
  // Only scan the YAML for ids when there are featured cards to match against.
  const existingIds = featuredById.size ? memoIds(host.yaml) : new Set<string>();

  return platformCompatible.filter((c) => {
    const fc = featuredById.get(c.id);
    if (fc && featuredIdPresent(fc, existingIds)) {
      return false;
    }
    const refId = fc?.component_id ?? c.id;
    if (!c.multi_conf && isComponentPresent(refId, present, presentPlatforms)) {
      return false;
    }
    if (coreCompatible && c.id.includes(".") && c.dependencies.length > 0) {
      const allSatisfied = c.dependencies.every(
        (dep) => coreCompatible.has(dep) || present.has(dep)
      );
      if (!allSatisfied) return false;
    }
    return true;
  });
}

// Ids of entries that share a name with another visible entry in the same
// category — two platforms of one domain (stepper.a4988 / stepper.uln2003)
// both inherit the domain's docs-page name. Keying on category as well as
// name leaves cross-category collisions (sensor.debug / text_sensor.debug)
// out: the category chip already separates those, and their stems match.
export function ambiguousNameIds(components: ComponentCatalogEntry[]): Set<string> {
  const byKey = new Map<string, ComponentCatalogEntry[]>();
  for (const c of components) {
    const key = JSON.stringify([c.category, c.name]);
    const group = byKey.get(key);
    if (group) group.push(c);
    else byKey.set(key, [c]);
  }
  const ids = new Set<string>();
  for (const group of byKey.values()) {
    if (group.length > 1) for (const c of group) ids.add(c.id);
  }
  return ids;
}

// A bundle drops a fixed set of featured peripherals (each with a preset id)
// into the config at once. It's fully configured when every component's preset
// id is in the YAML, so hide it then — a second add would duplicate all of them.
function presentBundleIds(host: ESPHomeComponentCatalog): Set<string> {
  const board = host.board;
  const bundles = board?.featured_bundles ?? [];
  if (!board || bundles.length === 0) return new Set();
  const presetIdByLocal = new Map<string, string>();
  for (const fc of board.featured_components ?? []) {
    const presetId = fc.fields?.["id"]?.value;
    if (typeof presetId === "string") presetIdByLocal.set(fc.id, presetId);
  }
  const existingIds = memoIds(host.yaml);
  const out = new Set<string>();
  for (const bundle of bundles) {
    const ids = bundle.component_ids
      .map((cid) => presetIdByLocal.get(cid))
      .filter((id): id is string => id !== undefined);
    if (ids.length > 0 && ids.every((id) => existingIds.has(id))) out.add(bundle.id);
  }
  return out;
}

// Bundles live on boards/get_board (not components/*) — filter client-side
// so a search behaves consistently across featured + bundles + components.
export function filteredBundles(host: ESPHomeComponentCatalog): FeaturedBundle[] {
  const present = presentBundleIds(host);
  const bundles = (host.board?.featured_bundles ?? []).filter((b) => !present.has(b.id));
  const q = host._search.trim().toLowerCase();
  if (!q) return bundles;
  return bundles.filter(
    (b) =>
      b.name.toLowerCase().includes(q) ||
      b.description.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q)
  );
}

// Recommendations shown for this board: a featured component counts when it's
// multi-conf or not yet configured; a bundle counts until it's fully
// configured, matching the grid (`filteredBundles`). Drives the
// Recommended badge and the auto-select so an all-configured board collapses
// the category instead of showing an empty "0 of N" list. No platform gate
// here (unlike `visibleComponents`): a board only recommends its own
// platform-compatible components, and `FeaturedComponent` carries no
// `supported_platforms` to gate on.
export function availableFeaturedCount(host: ESPHomeComponentCatalog): number {
  const board = host.board;
  if (!board) return 0;
  const featured = board.featured_components ?? [];
  const present = memoPresent(host.yaml);
  const presentPlatforms = memoPlatforms(host.yaml);
  const existingIds = featured.length ? memoIds(host.yaml) : new Set<string>();
  // `!== false`, not truthy: the backend omits the `true` default, so an
  // absent multi_conf means multi-conf (still addable). A featured peripheral
  // whose preset id is already configured is never addable, regardless.
  const addable = (fc: FeaturedComponent) =>
    !featuredIdPresent(fc, existingIds) &&
    (fc.multi_conf !== false ||
      !isComponentPresent(fc.component_id, present, presentPlatforms));
  const components = featured.filter(addable).length;
  const presentBundles = presentBundleIds(host);
  const bundles = (board.featured_bundles ?? []).filter(
    (b) => !presentBundles.has(b.id)
  ).length;
  return components + bundles;
}

interface CategoryEntry {
  id: string;
  label: string;
  count: number;
}

export function buildCategories(
  host: ESPHomeComponentCatalog,
  localize: LocalizeFunc
): CategoryEntry[] {
  const excluded = new Set(host.excludeCategories);
  const visibleCats = host._categories.filter((c) => !excluded.has(c.id));
  // Badge the post-filter available count so an all-configured board drops the
  // "Featured" row entirely (the if-guard below); the backend category count is
  // pre-filter and would leave a stale, empty badge. Skipped in locked mode —
  // the sidebar is hidden, so the YAML reparse would be pure overhead.
  const featuredBadge = host.lockedCategories.length ? 0 : availableFeaturedCount(host);
  const sortableCats = visibleCats.filter((c) => c.id !== ComponentCategory.FEATURED);
  const visibleTotal = excluded.size
    ? sortableCats.reduce((sum, c) => sum + c.count, 0)
    : host._total;
  // Derive category labels deterministically from the id (the same
  // `categoryChipLabel` the card chip uses) rather than a translation table.
  // Categories map directly to YAML keys, so a half-translated panel reads
  // worse than consistent English — and a per-category i18n table drifts out
  // of step with the chip as new categories ship from the sync script
  // (device-builder-frontend#636). Sort alphabetically by the resulting label;
  // the backend sorts by count, which doesn't help discovery.
  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  const sortedCats = sortableCats
    .map((cat) => ({
      id: cat.id,
      label: categoryChipLabel(cat.id),
      count: cat.count,
    }))
    .sort((a, b) => collator.compare(a.label, b.label));
  const cats: CategoryEntry[] = [];
  if (featuredBadge > 0) {
    cats.push({
      id: ComponentCategory.FEATURED,
      label: localize("device.component_category_featured"),
      count: featuredBadge,
    });
  }
  cats.push({
    id: "all",
    label: localize("device.component_category_all"),
    count: visibleTotal,
  });
  cats.push(...sortedCats);
  return cats;
}
