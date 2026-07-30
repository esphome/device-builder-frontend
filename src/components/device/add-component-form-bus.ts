/**
 * Bus-hostability verdict for the add-component form, lifted out of the
 * host so the decision branches are pure over `(api, component, yaml,
 * board)`. The host keeps the seq guard, the state assignment, and the
 * value seeding.
 */
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { ComponentCatalogEntry } from "../../api/types/components.js";
import { assessBusHostability, exclusiveBusTarget } from "../../util/bus-availability.js";
import { yamlHasExternalIdSources } from "../../util/config-entry-yaml-scan.js";
import { loadCatalog } from "../../util/yaml-completion-catalog.js";
import { parseTopLevelComponents } from "../../util/yaml-serialize.js";
import { depsSatisfiedByProvides } from "./add-component-deps.js";
import { findReferencePath } from "./add-component-form-seed.js";

export interface BusVerdict {
  /** Bus dep present in the YAML but with no bus the component can
   *  attach to; fold into the missing-deps gate. */
  blocked: string | null;
  /** Reference key to force visible when several buses qualify. */
  picker: string | null;
  /** The sole compatible bus to seed into the reference field. */
  reference: { domain: string; id: string } | null;
}

export const NO_BUS_VERDICT: BusVerdict = {
  blocked: null,
  picker: null,
  reference: null,
};

/**
 * Resolve the bus verdict for `(component, yaml)`: no attachable bus
 * flags the dep missing, a sole compatible bus becomes the reference to
 * seed, several force the picker. Anything uncertain — a catalog
 * failure, a configured bus provider (a `usb_uart:` channel the bus
 * scan can't model), an include or anchor merge hiding ids — resolves
 * to no verdict.
 */
export async function resolveBusVerdict(
  api: ESPHomeAPI,
  component: ComponentCatalogEntry,
  yaml: string,
  board: BoardCatalogEntry | null
): Promise<BusVerdict> {
  const target = exclusiveBusTarget(component);
  if (!target || yamlHasExternalIdSources(yaml)) return NO_BUS_VERDICT;
  // `loadCatalog` resolves to an empty index on failure rather than
  // rejecting; an empty index records no claims, so bail with no
  // verdict instead of affirmatively seeding a bus it has no
  // evidence for.
  const catalog = await loadCatalog(api);
  if (catalog.byId.size === 0) return NO_BUS_VERDICT;
  const { busCount, compatibleIds } = assessBusHostability(
    yaml,
    target.domain,
    target.constraints,
    (id) => catalog.byId.get(id)?.bus_constraints
  );
  // On a multi-bus config an un-idded compatible bus is unusable —
  // without an explicit reference esphome fails on the ambiguity — so
  // it falls through to the detour rather than shipping one.
  const usable = busCount > 1 ? compatibleIds.filter((id) => id !== null) : compatibleIds;
  if (busCount > 0 && usable.length === 0) {
    // The local verdict stands on parsed evidence; the provider escape
    // only clears it, and a failed provider lookup doesn't discard it.
    let blocked: string | null = target.domain;
    try {
      const present = parseTopLevelComponents(yaml);
      const satisfied = await depsSatisfiedByProvides(api, [target.domain], present, {
        platform: board?.esphome.platform ?? null,
        boardId: board?.id ?? null,
      });
      if (satisfied.has(target.domain)) blocked = null;
    } catch (err) {
      console.warn("[add-component-form] bus provider lookup failed", err);
    }
    return { ...NO_BUS_VERDICT, blocked };
  }
  if (usable.length === 1) {
    const id = usable[0];
    return id === null
      ? NO_BUS_VERDICT
      : { ...NO_BUS_VERDICT, reference: { domain: target.domain, id } };
  }
  if (usable.length > 1) {
    // `overlayRequired` matches top-level keys only; a nested reference
    // (none exists today) just skips the forcing.
    const path = findReferencePath(component.config_entries, target.domain, []);
    if (path?.length === 1) return { ...NO_BUS_VERDICT, picker: path[0] };
  }
  return NO_BUS_VERDICT;
}
