/**
 * Stable keys for the rows of a controlled list whose items carry no id.
 *
 * An edit replaces the edited item with a new object, and a read of the
 * YAML replaces them all, so neither an index nor an object alone
 * identifies a row. Keys derive from the arrays handed in, so an edit the
 * parent drops changes nothing.
 */
export class RowKeys<T extends object> {
  private _items: readonly T[] = [];
  private _keys: readonly number[] = [];
  private _next = 0;

  /**
   * The keys of *items*, in order; the same list gives the same keys.
   *
   * An item that is the same object as before keeps its key, which follows
   * every untouched row through a delete, a reorder or an append. A new
   * object with the content of a row that is gone takes that row's key,
   * which follows the rows of a list read again from a YAML where a row
   * was added, removed or moved. An item replaced in place (a field edit,
   * a change of kind) takes the key its index had. Anything else is a new
   * row.
   */
  keysFor(items: readonly T[]): readonly number[] {
    // One object can be listed more than once, so each holds a queue.
    const previous = new Map<T, number[]>();
    this._items.forEach((item, i) => queue(previous, item, this._keys[i]));
    const same = items.map((item) => previous.get(item)?.shift());
    const gone = [...previous].flatMap(([item, keys]) =>
      keys.map((key) => ({ item, key }))
    );
    const kept = this._matchContent(items, same, gone);
    const taken = new Set(kept);
    this._keys = kept.map((key, i) => {
      if (key !== undefined) return key;
      const inPlace = this._keys[i];
      if (inPlace === undefined || taken.has(inPlace)) return this._next++;
      taken.add(inPlace);
      return inPlace;
    });
    this._items = items;
    return this._keys;
  }

  /** *keys* with the rows that have none given the key of a row in *gone*
   *  with the same content. */
  private _matchContent(
    items: readonly T[],
    keys: readonly (number | undefined)[],
    gone: readonly { item: T; key: number }[]
  ): (number | undefined)[] {
    const open = keys.flatMap((key, i) => (key === undefined ? [i] : []));
    // One row replaced where it is, as on every keystroke in a field:
    // position gives it its key, and its content is another by now.
    const inPlace =
      open.length === 1 && gone.length === 1 && this._keys[open[0]] === gone[0].key;
    if (open.length === 0 || gone.length === 0 || inPlace) return [...keys];
    const byContent = new Map<string, number[]>();
    for (const { item, key } of gone) queue(byContent, contentOf(item), key);
    return keys.map((key, i) => key ?? byContent.get(contentOf(items[i]))?.shift());
  }
}

function queue<K>(queues: Map<K, number[]>, of: K, key: number): void {
  const held = queues.get(of);
  if (held) held.push(key);
  else queues.set(of, [key]);
}

const isEmpty = (value: unknown): boolean =>
  value !== null && typeof value === "object" && Object.keys(value).length === 0;

/**
 * What *item* holds, in one form whichever way it came to be. A field set
 * in the form is stored last where the YAML has it where it was written,
 * so the keys of each mapping are put in one order. A node made in the
 * editor has its empty lists and mappings where a parsed one leaves them
 * out, so those are left out.
 */
function contentOf(item: object): string {
  return JSON.stringify(item, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, held]) => !isEmpty(held))
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        )
      : value
  );
}
