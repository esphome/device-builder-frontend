/**
 * Dispatch a bubbling, composed ``CustomEvent`` from *target* — the
 * cross-shadow-boundary shape component action events use. Events meant
 * for a direct listener only should stay non-bubbling (see
 * ``options-combobox-event.ts``).
 */
export function fireEvent(target: EventTarget, name: string, detail?: unknown): void {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
