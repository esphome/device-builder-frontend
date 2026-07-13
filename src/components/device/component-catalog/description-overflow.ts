/**
 * Which clamped description paragraphs actually overflow their
 * line clamp, keyed by the card id stamped on data-component-id.
 * Drives whether a card renders its expand button at all: a
 * description that fits (or is empty) has nothing to reveal, so
 * the button would only reflow the grid — dead UI.
 */
export function overflowingDescriptionIds(
  paragraphs: Iterable<HTMLElement>
): Set<string> {
  const ids = new Set<string>();
  for (const el of paragraphs) {
    const id = el.dataset.componentId;
    if (id && el.scrollHeight > el.clientHeight) ids.add(id);
  }
  return ids;
}
