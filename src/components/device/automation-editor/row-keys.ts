/**
 * Stable keys for the rows of a controlled list whose items carry no id.
 *
 * The automation lists emit a new array and wait for the parent to hand it
 * back, and an edit replaces the edited node (and every ancestor) with a
 * new object, so neither an index nor an object alone identifies a row.
 * Keys are derived from the arrays themselves rather than from the
 * operation that was asked for, so an edit the parent drops changes
 * nothing here.
 */
export class RowKeys<T extends object> {
  private _items: readonly T[] = [];
  private _keys: readonly number[] = [];
  private _next = 0;

  /**
   * One key per item of *next*, in order.
   *
   * An item that is the same object as before keeps its key, which follows
   * every untouched row through a delete, a reorder or an append. An item
   * replaced in place (a field edit, a change of kind, a re-parse) takes
   * the key its index had. Anything else is a new row.
   */
  reconcile(next: readonly T[]): readonly number[] {
    if (next === this._items) return this._keys;
    const previous = new Map<T, number>();
    this._items.forEach((item, i) => previous.set(item, this._keys[i]));
    const kept = next.map((item) => {
      const key = previous.get(item);
      // Each key names one row; the same object listed twice is two rows.
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
    return keys;
  }
}
