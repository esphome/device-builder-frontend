export const BLE_NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";

/** Thrown (and forwarded via onDisconnect) when the connected device does not
 *  advertise the NUS service — the user picked the wrong device. */
export class BleNusServiceNotFoundError extends Error {
  constructor() {
    super("BLE NUS service not found");
  }
}
// TX characteristic: device → host (notify)
const BLE_NUS_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

/**
 * Open the browser's device picker for a BLE NUS peripheral.
 *
 * When ``deviceName`` is provided the picker is pre-filtered to that exact
 * name — most nRF52 devices only advertise their name, not the NUS service
 * UUID, so a service-UUID filter would show an empty list. ``optionalServices``
 * is always included so the browser grants GATT access regardless of the
 * filter type (Web Bluetooth requires every service you'll call
 * ``getPrimaryService`` on to appear in either ``filters[].services`` or
 * ``optionalServices``).
 *
 * Returns null when the user dismisses the picker (NotFoundError); re-throws
 * on other errors (Bluetooth unavailable, permission denied, etc.).
 */
export async function requestBleNusDevice(
  deviceName?: string
): Promise<BluetoothDevice | null> {
  const filters: BluetoothRequestDeviceFilter[] = deviceName
    ? [{ name: deviceName }]
    : [{ services: [BLE_NUS_SERVICE_UUID] }];
  try {
    return await navigator.bluetooth.requestDevice({
      filters,
      optionalServices: [BLE_NUS_SERVICE_UUID],
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") return null;
    throw err;
  }
}

/**
 * Connect to a BLE NUS peripheral and stream decoded log lines to the
 * callbacks.
 *
 * Resolves to a cancel function once the GATT connection is established and
 * notifications are enabled — the session stays in ``reconnecting`` until
 * this point. Resolves to null if the connection fails (``onDisconnect`` is
 * called with the error before null is returned). Call cancel() to stop
 * streaming and disconnect; it is idempotent and safe to call after a remote
 * disconnect.
 */
export async function streamBleNus(
  device: BluetoothDevice,
  callbacks: {
    onLine: (line: string) => void;
    onDisconnect?: (error?: unknown) => void;
  }
): Promise<(() => void) | null> {
  let cancelled = false;
  let txChar: BluetoothRemoteGATTCharacteristic | null = null;
  let lineBuffer = "";
  const decoder = new TextDecoder();

  const onValue = (): void => {
    if (cancelled) return;
    const dv = txChar?.value;
    if (!dv) return;
    const chunk = decoder.decode(dv, { stream: true });
    lineBuffer += chunk;
    let nl: number;
    while ((nl = lineBuffer.indexOf("\n")) !== -1) {
      callbacks.onLine(lineBuffer.slice(0, nl));
      lineBuffer = lineBuffer.slice(nl + 1);
    }
  };

  // Self-removing so stale listeners don't accumulate across reconnects.
  // Chrome reuses the same characteristic object across sessions, so the
  // characteristicvaluechanged listener must also be cleaned up here.
  const onDisconnected = (): void => {
    if (cancelled) return;
    cancelled = true;
    device.removeEventListener("gattserverdisconnected", onDisconnected);
    if (txChar) {
      txChar.removeEventListener("characteristicvaluechanged", onValue);
      txChar = null;
    }
    callbacks.onDisconnect?.();
  };

  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    device.removeEventListener("gattserverdisconnected", onDisconnected);
    if (txChar) {
      txChar.removeEventListener("characteristicvaluechanged", onValue);
      txChar = null;
    }
    device.gatt?.disconnect();
  };

  try {
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(BLE_NUS_SERVICE_UUID).catch(() => {
      throw new BleNusServiceNotFoundError();
    });
    const char = await service.getCharacteristic(BLE_NUS_TX_UUID);
    if (cancelled) return null;
    txChar = char;
    char.addEventListener("characteristicvaluechanged", onValue);
    // Chrome caches the "subscribed" flag per characteristic across sessions.
    // If the device reset CCCD on disconnect (standard BLE behavior) Chrome
    // won't rewrite it unless we clear its state first. stopNotifications()
    // drops Chrome's flag so the subsequent startNotifications() re-enables
    // CCCD unconditionally. No-op if notifications weren't active.
    await char.stopNotifications().catch(() => {});
    await char.startNotifications();
    device.addEventListener("gattserverdisconnected", onDisconnected);
    return cancel;
  } catch (err) {
    cancelled = true;
    callbacks.onDisconnect?.(err);
    return null;
  }
}
