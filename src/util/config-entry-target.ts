import type { ConfigEntry } from "../api/types/config-entries.js";

/** Whether two entry lists are the same form target, told by identity so
 *  two definitions with like-named fields stay distinct. A host that
 *  rebuilds its list on every render still hands over the same entries: a
 *  ``filter`` keeps the catalog's objects, and a list section wraps the
 *  catalog's own array in a new entry each time. */
export function sameEntryTarget(a: ConfigEntry[], b: ConfigEntry[]): boolean {
  return a.length === b.length && a.every((entry, i) => sameEntry(entry, b[i]));
}

function sameEntry(a: ConfigEntry, b: ConfigEntry): boolean {
  if (a === b) return true;
  return (
    !!a.config_entries &&
    a.config_entries === b.config_entries &&
    a.key === b.key &&
    a.type === b.type
  );
}
