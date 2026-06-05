import type { FeaturedBundle } from "../../../api/types/boards.js";
import {
  type ComponentCatalogEntry,
  ComponentCategory,
} from "../../../api/types/components.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import {
  parseConfiguredPlatforms,
  parseTopLevelComponents,
} from "../../../util/yaml-serialize.js";
import { categoryChipLabel } from "../component-card-category-label.js";
import type { ESPHomeComponentCatalog } from "../component-catalog.js";

// Two filters applied client-side:
//  1. Single-instance components already in the YAML get hidden.
//     - bare top-level (`web_server`, `wifi`) → match presence of `<id>:`
//     - platform variant (`time.homeassistant`) → match `<domain>.<platform>`
//     Multi-conf components always stay visible.
//  2. Core-locked: drop platform variants whose dependencies can't be
//     satisfied from this dialog. A dep counts as satisfied when it's
//     already in the user's YAML OR one of the IDs in this response.
export function visibleComponents(
  host: ESPHomeComponentCatalog
): ComponentCatalogEntry[] {
  const present = host.yaml ? parseTopLevelComponents(host.yaml) : new Set<string>();
  const presentPlatforms = host.yaml
    ? parseConfiguredPlatforms(host.yaml)
    : new Set<string>();
  const lockedToCore = host.lockedCategories.length > 0;
  const coreCompatible = lockedToCore ? new Set(host._components.map((c) => c.id)) : null;

  return host._components.filter((c) => {
    if (!c.multi_conf) {
      if (c.id.includes(".")) {
        if (presentPlatforms.has(c.id)) return false;
      } else if (present.has(c.id)) {
        return false;
      }
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

// Bundles live on boards/get_board (not components/*) — filter client-side
// so a search behaves consistently across featured + bundles + components.
export function filteredBundles(host: ESPHomeComponentCatalog): FeaturedBundle[] {
  const bundles = host.board?.featured_bundles ?? [];
  const q = host._search.trim().toLowerCase();
  if (!q) return bundles;
  return bundles.filter(
    (b) =>
      b.name.toLowerCase().includes(q) ||
      b.description.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q)
  );
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
  // Pin "Featured" — peel it out so it doesn't appear twice in the alpha list.
  const featuredCat = visibleCats.find((c) => c.id === ComponentCategory.FEATURED);
  const bundleCount = host.board?.featured_bundles?.length ?? 0;
  // Bundles live on the board manifest, not in components categories —
  // add them to the headline count so the badge matches the rendered grid.
  const featuredBadge = featuredCat ? featuredCat.count + bundleCount : bundleCount;
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
