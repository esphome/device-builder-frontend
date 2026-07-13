/** Behavior side of ``field-highlight.styles.ts``: the one-shot cursor
 *  glow shared by the form's field scroll and the automation editors'
 *  row scroll. */

/** Class that runs the glow animation; defined in ``fieldHighlightStyles``. */
export const FIELD_FLASH_CLASS = "field--highlight";

/**
 * Restart the one-shot glow on *el*.
 *
 * Skipped under reduced motion: the animation is disabled there, so
 * adding the class only strands it (``animationend`` never fires).
 */
export function flashHighlight(el: HTMLElement): void {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  el.classList.remove(FIELD_FLASH_CLASS);
  void el.offsetWidth;
  el.classList.add(FIELD_FLASH_CLASS);
  el.addEventListener("animationend", () => el.classList.remove(FIELD_FLASH_CLASS), {
    once: true,
  });
}

/** Scroll a node row into view with the glow. */
export function scrollFlashRow(row: HTMLElement): void {
  row.scrollIntoView({ block: "center" });
  flashHighlight(row);
}
