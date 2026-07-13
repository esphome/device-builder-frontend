/**
 * Which clamped description paragraphs actually overflow their
 * line clamp, keyed by the card id stamped on data-component-id.
 * Drives whether a card renders its expand button at all: a
 * description that fits (or is empty) has nothing to reveal, so
 * the button would only reflow the grid — dead UI.
 *
 * Pure over the injected predicate so tests can stub layout
 * (happy-dom reports 0 for scroll metrics).
 */
export function overflowingDescriptionIds(
  paragraphs: Iterable<HTMLElement>,
  isOverflowing: (el: HTMLElement) => boolean = (el) => el.scrollHeight > el.clientHeight
): Set<string> {
  const ids = new Set<string>();
  for (const el of paragraphs) {
    const id = el.dataset.componentId;
    if (id && isOverflowing(el)) ids.add(id);
  }
  return ids;
}

export function sameIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
