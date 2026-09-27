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
    const kept = items.map((item) => previous.get(item)?.shift());
    const taken = new Set(kept);
    this._matchContent(items, kept, taken);
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

  /** Give the rows of *items* that have no key yet the key of a previous
   *  row with the same content that no row has claimed. */
  private _matchContent(
    items: readonly T[],
    kept: (number | undefined)[],
    taken: Set<number | undefined>
  ): void {
    if (!kept.includes(undefined)) return;
    const gone = new Map<string, number[]>();
    this._items.forEach((item, i) => {
      if (!taken.has(this._keys[i])) queue(gone, JSON.stringify(item), this._keys[i]);
    });
    if (gone.size === 0) return;
    items.forEach((item, i) => {
      if (kept[i] !== undefined) return;
      kept[i] = gone.get(JSON.stringify(item))?.shift();
      taken.add(kept[i]);
    });
  }
}

function queue<K>(queues: Map<K, number[]>, of: K, key: number): void {
  const held = queues.get(of);
  if (held) held.push(key);
  else queues.set(of, [key]);
}
