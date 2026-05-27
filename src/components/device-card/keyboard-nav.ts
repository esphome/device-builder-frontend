import type { ESPHomeDeviceCard } from "../device-card.js";

// Pick the card on the next row whose horizontal centre is closest to ours.
// The grid is auto-fill so column count varies by viewport — using rendered
// rects keeps nav working at any width without re-deriving the count.
export function navigateCards(card: ESPHomeDeviceCard, key: string): void {
  const grid = card.parentElement;
  if (!grid) return;
  const cards = Array.from(
    grid.querySelectorAll<ESPHomeDeviceCard>("esphome-device-card")
  );
  const idx = cards.indexOf(card);
  if (idx < 0) return;

  if (key === "Home") return cards[0]?.focus();
  if (key === "End") return cards[cards.length - 1]?.focus();
  if (key === "ArrowRight") return cards[idx + 1]?.focus();
  if (key === "ArrowLeft") return cards[idx - 1]?.focus();

  const rect = card.getBoundingClientRect();
  const myCenter = rect.left + rect.width / 2;
  const direction = key === "ArrowDown" ? 1 : -1;
  const withRects = cards
    .filter((c) => c !== card)
    .map((c) => ({ c, r: c.getBoundingClientRect() }))
    .filter(({ r }) => direction * (r.top - rect.top) > 1);
  if (!withRects.length) return;
  withRects.sort((a, b) => direction * (a.r.top - b.r.top));
  const targetTop = withRects[0].r.top;
  const sameRow = withRects.filter(({ r }) => Math.abs(r.top - targetTop) < 1);
  sameRow.sort(
    (a, b) =>
      Math.abs(a.r.left + a.r.width / 2 - myCenter) -
      Math.abs(b.r.left + b.r.width / 2 - myCenter)
  );
  sameRow[0]?.c.focus();
}

// Right-clicks on inner interactive controls must bypass the card-context
// menu — the Visit Web UI link needs the browser's native menu for
// "Open in new tab" / "Copy link", and any inner button does the same.
function originatesOnControl(card: ESPHomeDeviceCard, e: MouseEvent): boolean {
  for (const el of e.composedPath()) {
    if (!(el instanceof HTMLElement)) continue;
    if (el === card) return false;
    const tag = el.tagName;
    if (
      tag === "A" ||
      tag === "BUTTON" ||
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT"
    ) {
      return true;
    }
  }
  return false;
}

export function onHostContextMenu(card: ESPHomeDeviceCard, e: MouseEvent): void {
  // Select mode hides per-row actions; a right-click menu would mislead.
  if (card.selectMode) return;
  if (originatesOnControl(card, e)) return;
  e.preventDefault();
  e.stopPropagation();
  card.dispatchEvent(
    new CustomEvent("card-context-menu", {
      detail: { x: e.clientX, y: e.clientY },
      bubbles: true,
      composed: true,
    })
  );
}
