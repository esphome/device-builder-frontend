export const BLE_NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
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
 * callbacks. Returns a cancel function immediately; the GATT connect runs
 * asynchronously inside. Call cancel() to stop streaming and disconnect.
 * The cancel is idempotent and safe to call after a disconnect.
 */
export function streamBleNus(
  device: BluetoothDevice,
  callbacks: {
    onLine: (line: string) => void;
    onDisconnect?: (error?: unknown) => void;
  }
): () => void {
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

  const onDisconnected = (): void => {
    if (cancelled) return;
    cancelled = true;
    txChar = null;
    callbacks.onDisconnect?.();
  };

  async function connect(): Promise<void> {
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(BLE_NUS_SERVICE_UUID);
    const char = await service.getCharacteristic(BLE_NUS_TX_UUID);
    if (cancelled) return;
    txChar = char;
    char.addEventListener("characteristicvaluechanged", onValue);
    await char.startNotifications();
    device.addEventListener("gattserverdisconnected", onDisconnected);
  }

  connect().catch((err: unknown) => {
    if (!cancelled) {
      cancelled = true;
      callbacks.onDisconnect?.(err);
    }
  });

  return (): void => {
    if (cancelled) return;
    cancelled = true;
    device.removeEventListener("gattserverdisconnected", onDisconnected);
    if (txChar) {
      txChar.removeEventListener("characteristicvaluechanged", onValue);
      txChar = null;
    }
    device.gatt?.disconnect();
  };
}
