/**
 * Dispatch a bubbling, composed ``CustomEvent`` from *target* — the
 * cross-shadow-boundary shape component action events use. Events meant
 * for a direct listener only should stay non-bubbling (see
 * ``options-combobox-event.ts``).
 *
 * Omitting *detail* dispatches with ``event.detail === null``, same as
 * an inline ``new CustomEvent(name)`` — WebIDL treats an ``undefined``
 * dictionary member as absent, so the ``CustomEventInit`` default
 * applies (pinned by the unit test).
 */
export function fireEvent(target: EventTarget, name: string, detail?: unknown): void {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
