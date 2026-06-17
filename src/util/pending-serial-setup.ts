/**
 * One-shot "resume USB setup on the dashboard's next mount" signal.
 *
 * The "USB device connected" toast is global, but the serial-setup
 * handler and the create-config wizard live only on the dashboard. When
 * the toast is actioned from another route (the device editor / secrets)
 * we stash the captured ``SerialPort`` here and navigate to the
 * dashboard, which consumes it on mount and opens the wizard.
 *
 * Backed by a module-level variable, not ``sessionStorage``: a live
 * ``SerialPort`` isn't serializable, and ``navigate("/")`` is a
 * same-document ``pushState`` so module state survives the route change.
 * The wrapper object distinguishes a stashed ``null`` port (the toast
 * can capture none) from "nothing pending".
 */

let pending: { port: SerialPort | null } | null = null;

/** Stash *port* to be picked up by the dashboard's next mount. */
export function markPendingSerialSetup(port: SerialPort | null): void {
  pending = { port };
}

/** Atomically read + clear the stash; ``null`` when nothing's pending. */
export function consumePendingSerialSetup(): { port: SerialPort | null } | null {
  const p = pending;
  pending = null;
  return p;
}
