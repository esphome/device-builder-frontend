/** Flattened-tree parent: slotted nodes climb through their slot, shadow
 *  roots through their host. */
export function composedParent(el: Element): Element | null {
  if (el.assignedSlot) return el.assignedSlot;
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Nearest composed-tree ancestor that actually scrolls vertically. */
export function nearestScrollContainer(el: Element): HTMLElement | null {
  for (let n = composedParent(el); n; n = composedParent(n)) {
    if (n instanceof HTMLElement && n.scrollHeight > n.clientHeight) {
      const overflowY = getComputedStyle(n).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return n;
    }
  }
  return null;
}
