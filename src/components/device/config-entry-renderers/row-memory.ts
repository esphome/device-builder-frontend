/**
 * What a form remembers about a field (the other side of a Value / Lambda
 * toggle, a unit picked on an empty field, an open group) is keyed by the
 * field's dotted path, and a list row's path holds the row's index. When a
 * row leaves the list the rows below it move up, so their keys are
 * renumbered to follow them and the removed row's are dropped.
 */
import { isIndexSegment } from "../../../util/nested-values.js";
import { fieldKeyAttr, parseFieldKey } from "../config-entry-renderers-shared.js";

/** New key for a remembered entry; ``null`` drops the entry. */
export type Rekey = (key: string) => string | null;

/** Where a list row goes, by its index: its new index, or ``null`` when
 *  what was remembered for it is dropped. */
export type RowMove = (row: number) => number | null;

/** Row *index* leaves a list: the rows below it move up one. */
export const rowRemoved =
  (index: number): RowMove =>
  (row) =>
    row === index ? null : row > index ? row - 1 : row;

/** Row *index* stays where it is and loses what was remembered for it. */
export const rowForgotten =
  (index: number): RowMove =>
  (row) =>
    row === index ? null : row;

/** The rekeyer for the rows of the list at *path* going where *move* says. */
export function rowRekeyer(path: string[], move: RowMove): Rekey {
  const prefix = `${path.join(".")}.`;
  return (key) => {
    if (!key.startsWith(prefix)) return key;
    const rest = key.slice(prefix.length);
    // The row's segment ends at the next one or at a ``:suffix``.
    const segment = rest.split(/[.:]/, 1)[0];
    if (!isIndexSegment(segment)) return key;
    const row = move(Number(segment));
    return row === null ? null : `${prefix}${row}${rest.slice(segment.length)}`;
  };
}

/** ``rowRekeyer`` for keys in the ``fieldKeyAttr`` form, which keeps a
 *  path's segments apart where a dotted key cannot. */
export function fieldKeyRowRekeyer(path: string[], move: RowMove): Rekey {
  return (key) => {
    const segments = parseFieldKey(key);
    const segment = segments?.[path.length];
    if (!segments || segment === undefined || !isIndexSegment(segment)) return key;
    if (!path.every((part, i) => segments[i] === part)) return key;
    const row = move(Number(segment));
    if (row === null) return null;
    return fieldKeyAttr([...path, String(row), ...segments.slice(path.length + 1)]);
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
