/**
 * Stable keys for the rows of a controlled list whose items carry no id.
 *
 * An edit replaces the edited item with a new object, so neither an index
 * nor an object alone identifies a row. Keys are derived from the arrays
 * the list is handed rather than from the operation it asked for, so an
 * edit the parent drops changes nothing here.
 */
export class RowKeys<T extends object> {
  private _items: readonly T[] = [];
  private _keys: readonly number[] = [];
  private _next = 0;

  /** The keys of the list last reconciled, in order. */
  get keys(): readonly number[] {
    return this._keys;
  }

  /**
   * Key the items of *next*.
   *
   * An item that is the same object as before keeps its key, which follows
   * every untouched row through a delete, a reorder or an append. An item
   * replaced in place (a field edit, a change of kind, a re-parse) takes
   * the key its index had. Anything else is a new row.
   */
  reconcile(next: readonly T[]): void {
    const previous = new Map<T, number>();
    this._items.forEach((item, i) => previous.set(item, this._keys[i]));
    const kept = next.map((item) => {
      const key = previous.get(item);
      previous.delete(item);
      return key;
    });
    const taken = new Set(kept);
    const keys = kept.map((key, i) => {
      if (key !== undefined) return key;
      const inPlace = this._keys[i];
      if (inPlace === undefined || taken.has(inPlace)) return this._next++;
      taken.add(inPlace);
      return inPlace;
    });
    this._items = next;
    this._keys = keys;
  }
}
