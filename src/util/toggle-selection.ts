/**
 * Toggle one id in a selection array without mutating the input.
 *
 * Returns the input array itself when the toggle is a no-op, so
 * callers can compare by reference to skip emitting a redundant
 * change event.
 */
export function toggleSelection(
  selected: readonly string[],
  id: string,
  select: boolean
): readonly string[] {
  if (selected.includes(id) === select) return selected;
  return select ? [...selected, id] : selected.filter((x) => x !== id);
}
