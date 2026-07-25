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

/**
 * Capture what a disk-writing delete needs to announce its
 * ``yaml-updated`` after the round trip, before any await: the
 * mount-time parent (the host may be unmounted by dispatch time —
 * detached dispatches bubble nowhere, #1465). The returned announcer
 * takes the write, its basis (the buffer it was computed against —
 * the page supersede-checks it and advances only the saved side when
 * the pane has moved past it, #1476), and the host's connectedness
 * at dispatch time.
 */
export function prepareYamlWritten(
  host: EventTarget & { readonly parentNode: ParentNode | null }
): (connected: boolean, yaml: string, basedOn: string) => void {
  const anchor = host.parentNode;
  return (connected, yaml, basedOn) =>
    fireFromAnchor(host, connected, anchor, "yaml-updated", { yaml, basedOn });
}
