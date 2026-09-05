import type {
  AutomationAction,
  AutomationCondition,
  AvailableComponentInstance,
} from "../../../api/types/automations.js";
import { componentDomain } from "./component-targets.js";

export type CatalogItem = AutomationAction | AutomationCondition;

/** A query that leaves this many target groups or fewer opens them all. */
export const AUTO_EXPAND_MAX_GROUPS = 5;

export function groupByDomain(
  items: CatalogItem[],
  key: (item: CatalogItem) => string = (item) => item.domain
): Map<string, CatalogItem[]> {
  const groups = new Map<string, CatalogItem[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k) ?? [];
    list.push(item);
    groups.set(k, list);
  }
  return groups;
}

/**
 * Filter the catalog by the lower-cased search query *q*. Match against the
 * id, name, and description fields. Case-insensitive substring match —
 * anything fancier (fuzzy / weighted) would surprise the user with hits they
 * couldn't explain.
 */
export function filterItems(items: CatalogItem[], q: string): CatalogItem[] {
  if (!q) return items;
  return items.filter(
    (i) =>
      i.id.toLowerCase().includes(q) ||
      i.name.toLowerCase().includes(q) ||
      (i.description ?? "").toLowerCase().includes(q)
  );
}

/** Items for the device's bare domain, then its exact platform id. */
export function itemsForDevice(
  byDomain: Map<string, CatalogItem[]>,
  device: AvailableComponentInstance
): CatalogItem[] {
  const domain = componentDomain(device.component_id);
  const generic = byDomain.get(domain) ?? [];
  const specific =
    device.component_id === domain ? undefined : byDomain.get(device.component_id);
  return specific ? generic.concat(specific) : generic;
}
