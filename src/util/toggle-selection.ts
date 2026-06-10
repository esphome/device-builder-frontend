/**
 * Toggle one id in a selection array without mutating the input.
 *
 * Returns the input array itself when the toggle is a no-op
 * (selecting an already-selected id), so callers can compare by
 * reference to skip emitting a redundant change event.
 */
export function toggleSelection(
  selected: readonly string[],
  id: string,
  select: boolean
): readonly string[] {
  if (select) {
    if (selected.includes(id)) return selected;
    return [...selected, id];
  }
  return selected.filter((x) => x !== id);
}
