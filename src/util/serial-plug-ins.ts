/**
 * What a ``navigator.serial`` ``connect`` event means. The browser fires it
 * for every port this origin already has permission for, and not only when
 * a board is plugged in: our own resets re-enumerate native-USB chips, and a
 * USB hub bounces its other ports when anything is plugged into it. Both
 * apps' plug-in toasts want only the real plug-ins.
 */
import {
  isOwnSerialReenumeration,
  portOfSerialConnectEvent,
} from "./serial-reacquire.js";

/**
 * How soon after its own ``disconnect`` a port's ``connect`` is a hub
 * re-enumeration rather than a plug-in. Plugging anything into a USB hub
 * can bounce the hub's other ports: every granted board on it drops and
 * comes back about half a second later (measured on macOS), while a hand
 * unplug and replug takes seconds (#1850).
 */
export const SERIAL_REENUMERATION_BLIP_MS = 1000;

/**
 * The device behind a port, for matching its ``disconnect`` to the
 * ``connect`` that follows: Chrome hands out a fresh ``SerialPort`` object
 * when a device re-enumerates, so the object is no key. Two identical
 * boards share one; a hub bounces both anyway.
 */
function deviceKey(port: SerialPort): string {
  const { usbVendorId, usbProductId } = port.getInfo();
  return `${usbVendorId ?? "?"}:${usbProductId ?? "?"}`;
}

/**
 * Report real plug-ins of already-permitted ports to *onPlugIn*. A
 * ``connect`` is dropped when it is our own reset re-enumerating the device
 * (``isOwnSerialReenumeration``) or when it follows the same device's own
 * ``disconnect`` within ``SERIAL_REENUMERATION_BLIP_MS``. The map holds at
 * most one entry per granted device. Returns the function that stops
 * watching.
 */
export function watchSerialPlugIns(onPlugIn: (port: SerialPort) => void): () => void {
  const disconnectedMs = new Map<string, number>();
  const onDisconnect = (event: Event): void => {
    const port = portOfSerialConnectEvent(event);
    if (port) disconnectedMs.set(deviceKey(port), Date.now());
  };
  const onConnect = (event: Event): void => {
    const port = portOfSerialConnectEvent(event);
    if (!port) return;
    // The first connect after a disconnect consumes the entry on every path.
    const key = deviceKey(port);
    const gone = disconnectedMs.get(key);
    disconnectedMs.delete(key);
    if (isOwnSerialReenumeration()) return;
    if (gone !== undefined && Date.now() - gone < SERIAL_REENUMERATION_BLIP_MS) return;
    onPlugIn(port);
  };
  const serial = navigator.serial;
  serial.addEventListener("connect", onConnect);
  serial.addEventListener("disconnect", onDisconnect);
  return () => {
    serial.removeEventListener("connect", onConnect);
    serial.removeEventListener("disconnect", onDisconnect);
  };
}
