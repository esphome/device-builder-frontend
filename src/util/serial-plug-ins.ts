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
 * when a device re-enumerates, so the object is no key. Ports without USB
 * ids (Bluetooth RFCOMM, for one) get none, as in ``matchesDevice``: two of
 * them would otherwise read as the same device. Web Serial exposes no
 * per-device serial, so two identical boards share a key: swapping one for
 * the other inside the blip reads as a bounce and costs one toast, which a
 * hand swap never manages in under a second.
 */
function deviceKey(port: SerialPort): string | null {
  const { usbVendorId, usbProductId } = port.getInfo();
  if (usbVendorId === undefined || usbProductId === undefined) return null;
  return `${usbVendorId}:${usbProductId}`;
}

/**
 * Report real plug-ins of already-permitted ports to *onPlugIn*. A
 * ``connect`` is dropped when it is our own reset re-enumerating the device
 * (``isOwnSerialReenumeration``) or when it follows the same device's own
 * ``disconnect`` within ``SERIAL_REENUMERATION_BLIP_MS``. Two identical
 * boards share a key, so each disconnect is kept and each connect consumes
 * one; the map holds at most one stamp per granted port. Returns the
 * function that stops watching.
 */
export function watchSerialPlugIns(onPlugIn: (port: SerialPort) => void): () => void {
  const disconnectedMs = new Map<string, number[]>();
  const onDisconnect = (event: Event): void => {
    const port = portOfSerialConnectEvent(event);
    const key = port && deviceKey(port);
    if (!key) return;
    const stamps = disconnectedMs.get(key) ?? [];
    stamps.push(Date.now());
    disconnectedMs.set(key, stamps);
  };
  const onConnect = (event: Event): void => {
    const port = portOfSerialConnectEvent(event);
    if (!port) return;
    // Only disconnects inside the blip count; a stale one (a twin unplugged
    // for good) must not stand in for this connect. The first connect after
    // a disconnect consumes it on every path.
    const key = deviceKey(port);
    const now = Date.now();
    const recent = key
      ? (disconnectedMs.get(key) ?? []).filter(
          (t) => now - t < SERIAL_REENUMERATION_BLIP_MS
        )
      : [];
    const blip = recent.length > 0;
    if (key) {
      if (blip) disconnectedMs.set(key, recent.slice(1));
      else disconnectedMs.delete(key);
    }
    if (isOwnSerialReenumeration()) return;
    if (blip) return;
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
