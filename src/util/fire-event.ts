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

/**
 * Dispatch from *host* while it is connected, else from *anchor* — a
 * detached dispatch bubbles nowhere. The anchor is the host's
 * mount-time parent, which outlives it across section switches; the
 * disk-writing delete paths rely on this to reach the page after a
 * mid-round-trip unmount (#1465).
 */
export function fireFromAnchor(
  host: EventTarget,
  connected: boolean,
  anchor: EventTarget | null,
  name: string,
  detail?: unknown
): void {
  const target = connected ? host : anchor;
  if (target) fireEvent(target, name, detail);
}
