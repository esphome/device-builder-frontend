/**
 * What a form remembers about a field (the other side of a Value / Lambda
 * toggle, a unit picked on an empty field, an open group) is keyed by the
 * field's dotted path, and a list row's path holds the row's index. When a
 * row leaves the list the rows below it move up one index, so their keys
 * are renumbered to follow them and the removed row's are dropped.
 */

/** New key for a remembered entry; ``null`` drops the entry. */
export type Rekey = (key: string) => string | null;

/**
 * The rekeyer for row *index* of the list at *path*: the row's own keys
 * are dropped, and with *shift* the keys of the rows below it move up.
 * A row whose kind changed is forgotten without a shift.
 */
export function rowRekeyer(path: string[], index: number, shift: boolean): Rekey {
  const prefix = `${path.join(".")}.`;
  return (key) => {
    if (!key.startsWith(prefix)) return key;
    // The index ends at the next path segment or at a ``:suffix``.
    const match = /^\d+(?=[.:]|$)/.exec(key.slice(prefix.length));
    if (!match) return key;
    const row = Number(match[0]);
    if (row === index) return null;
    if (!shift || row < index) return key;
    return `${prefix}${row - 1}${key.slice(prefix.length + match[0].length)}`;
  };
}

/** Apply *rekey* to every key of *store*, in place. */
export function rekeyStore<V>(store: Map<string, V> | Set<string>, rekey: Rekey): void {
  const entries = [...store.entries()] as [string, V | string][];
  store.clear();
  for (const [key, value] of entries) {
    const next = rekey(key);
    if (next === null) continue;
    if (store instanceof Set) store.add(next);
    else store.set(next, value as V);
  }
}
