/**
 * What a form remembers about a field (the other side of a Value / Lambda
 * toggle, a unit picked on an empty field, an open group) is keyed by the
 * field's dotted path, and a list row's path holds the row's index. When a
 * row leaves the list the rows below it move up one index, so their keys
 * are renumbered to follow them and the removed row's are dropped.
 */
import { isIndexSegment } from "../../../util/nested-values.js";
import { fieldKeyAttr, parseFieldKey } from "../config-entry-renderers-shared.js";

/** New key for a remembered entry; ``null`` drops the entry. */
export type Rekey = (key: string) => string | null;

/** The rekeyer for row *index* leaving the list at *path*. */
export function rowRekeyer(path: string[], index: number): Rekey {
  const prefix = `${path.join(".")}.`;
  return (key) => {
    if (!key.startsWith(prefix)) return key;
    const rest = key.slice(prefix.length);
    // The row's segment ends at the next one or at a ``:suffix``.
    const segment = rest.split(/[.:]/, 1)[0];
    if (!isIndexSegment(segment)) return key;
    const row = Number(segment);
    if (row === index) return null;
    if (row < index) return key;
    return `${prefix}${row - 1}${rest.slice(segment.length)}`;
  };
}

/** ``rowRekeyer`` for keys in the ``fieldKeyAttr`` form, which keeps a
 *  path's segments apart where a dotted key cannot. */
export function fieldKeyRowRekeyer(path: string[], index: number): Rekey {
  return (key) => {
    const segments = parseFieldKey(key);
    const segment = segments?.[path.length];
    if (!segments || segment === undefined || !isIndexSegment(segment)) return key;
    if (!path.every((part, i) => segments[i] === part)) return key;
    const row = Number(segment);
    if (row === index) return null;
    if (row < index) return key;
    return fieldKeyAttr([...path, String(row - 1), ...segments.slice(path.length + 1)]);
  };
}

/** Apply *rekey* to every key of *store*, in place. */
export function rekeyStore(
  store: Map<string, unknown> | Set<string>,
  rekey: Rekey
): void {
  const entries = [...store.entries()];
  store.clear();
  for (const [key, value] of entries) {
    const next = rekey(key);
    if (next === null) continue;
    if (store instanceof Set) store.add(next);
    else store.set(next, value);
  }
}
