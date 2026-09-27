import type { ConfigEntry } from "../api/types/config-entries.js";

/** Whether two entry lists describe the same fields, by key and type in
 *  order. A host that rebuilds its list on every render (a ``filter`` over
 *  the catalog's entries) hands over a new array of the same shape, which is
 *  not a re-target. */
export function sameEntryShape(a: ConfigEntry[], b: ConfigEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, i) => entry.key === b[i].key && entry.type === b[i].type)
  );
}
