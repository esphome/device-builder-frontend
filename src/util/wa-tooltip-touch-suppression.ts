/**
 * Suppress ``wa-tooltip`` on touch devices.
 *
 * A tap fires the browser's emulated ``mouseover``, so the tooltip's
 * delayed ``show()`` lands *after* the tap's click has already opened a
 * dialog — and with no ``mouseout`` (and on iOS no ``blur``) ever coming,
 * the tooltip sticks in the top layer above it. The tooltip dispatches a
 * cancellable composed ``wa-show`` before painting, so one document-level
 * listener suppresses every tooltip on hover-incapable devices. Anchors
 * keep their ``aria-label``/``aria-labelledby``, so nothing is lost.
 */
export function installWaTooltipTouchSuppression(): void {
  if (typeof document === "undefined") return;
  // Named handler so addEventListener dedupes a repeated install.
  document.addEventListener("wa-show", suppressTooltipShowOnTouch);
}

function suppressTooltipShowOnTouch(e: Event): void {
  // "wa-show" is shared by dialogs/dropdowns — only ever cancel tooltips.
  // composedPath, not target: crossing the shadow boundary retargets
  // the event to the host component.
  if ((e.composedPath()[0] as Element | undefined)?.localName !== "wa-tooltip") return;
  if (typeof window.matchMedia !== "function") return;
  if (window.matchMedia("(hover: none)").matches) e.preventDefault();
}
