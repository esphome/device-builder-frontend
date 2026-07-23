/**
 * ARIA radiogroup helpers shared by card-style choice groups (the
 * onboarding choice cards, the pin wiring presets). Moved out of
 * ``onboarding/choice-card.ts`` so non-wizard consumers don't import
 * the onboarding module.
 */

/**
 * Roving-tabindex tab stop for a choice in a ``role="radiogroup"``: the checked
 * card, or the first card when nothing in the group is checked yet.
 */
export function rovingTabbable(
  selected: boolean,
  anySelected: boolean,
  index: number
): boolean {
  return selected || (!anySelected && index === 0);
}

/**
 * Arrow-key handler for a ``role="radiogroup"`` of choice cards: Up/Left and
 * Down/Right move focus and selection across the enabled cards, wrapping at the
 * ends, per the ARIA radio pattern. Attach to the group's ``@keydown``.
 */
export function onChoiceGroupKeydown(e: KeyboardEvent): void {
  const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
  const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
  if (!forward && !back) return;
  const group = e.currentTarget as HTMLElement;
  const cards = Array.from(
    group.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')
  );
  if (cards.length === 0) return;
  const active = (e.target as HTMLElement | null)?.closest('[role="radio"]') ?? null;
  const current = active ? cards.indexOf(active as HTMLElement) : -1;
  const next =
    cards[(Math.max(current, 0) + (forward ? 1 : -1) + cards.length) % cards.length];
  e.preventDefault();
  next.focus();
  next.click();
}
