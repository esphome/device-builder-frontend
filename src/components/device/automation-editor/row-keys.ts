/**
 * Stable keys for the rows of a controlled list whose items carry no id.
 *
 * An edit replaces the edited item with a new object, so neither an index
 * nor an object alone identifies a row. Keys derive from the arrays handed
 * in, so an edit the parent drops changes nothing.
 */
export class RowKeys<T extends object> {
  private _items: readonly T[] = [];
  private _keys: readonly number[] = [];
  private _next = 0;

  /**
   * The keys of *items*, in order; the same list gives the same keys.
   *
   * An item that is the same object as before keeps its key, which follows
   * every untouched row through a delete, a reorder or an append. An item
   * replaced in place (a field edit, a change of kind, a re-parse) takes
   * the key its index had. Anything else is a new row.
   */
  keysFor(items: readonly T[]): readonly number[] {
    // One object can be listed more than once, so each holds a queue.
    const previous = new Map<T, number[]>();
    this._items.forEach((item, i) => {
      const held = previous.get(item);
      if (held) held.push(this._keys[i]);
      else previous.set(item, [this._keys[i]]);
    });
    const kept = items.map((item) => previous.get(item)?.shift());
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
}
