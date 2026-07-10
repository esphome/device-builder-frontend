import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { ComponentCatalogEntry } from "../api/types/components.js";

/** Page size for the fetch-all sweeps below — a stride, not a ceiling.
 *  Sized so today's full catalog (~940 entries) still lands in one
 *  round trip; growth past it pages instead of truncating. */
export const COMPONENT_FETCH_PAGE = 1000;

type ComponentQuery = Omit<
  NonNullable<Parameters<ESPHomeAPI["getComponents"]>[0]>,
  "offset" | "limit"
>;

/**
 * Every catalog entry matching `args`, paged on `resp.total` (#1152).
 *
 * The catalog is immutable for the process lifetime, so pages are
 * mutually consistent; a short page also ends the sweep so a
 * misreported `total` can't loop forever.
 */
export async function fetchAllComponents(
  api: ESPHomeAPI,
  args: ComponentQuery = {}
): Promise<ComponentCatalogEntry[]> {
  const components: ComponentCatalogEntry[] = [];
  for (;;) {
    const resp = await api.getComponents({
      ...args,
      offset: components.length,
      limit: COMPONENT_FETCH_PAGE,
    });
    components.push(...resp.components);
    if (
      components.length >= resp.total ||
      resp.components.length < COMPONENT_FETCH_PAGE
    ) {
      return components;
    }
  }
}
