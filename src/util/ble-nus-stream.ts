/**
 * Log streaming over the BLE Nordic UART Service (Web Bluetooth, Chromium
 * only). Lines go through the same assembler as Web Serial so both surfaces
 * render identically.
 */
import { isNrfPlatform } from "./nrf-platform.js";
import { createLogLineAssembler, type SerialLineHooks } from "./serial-log-stream.js";
import { sleep } from "./sleep.js";

export const BLE_NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
// TX characteristic: device -> host (notify).
const BLE_NUS_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

export const isWebBluetoothSupported = (): boolean => "bluetooth" in navigator;

/** BLE NUS logs are an nRF52 feature and need Web Bluetooth. */
export const bleNusLogsAvailable = (targetPlatform: string | null | undefined): boolean =>
  isWebBluetoothSupported() && isNrfPlatform(targetPlatform);

/** The picked device has no NUS service: the wrong device, not a bad link. */
export class BleNusServiceNotFoundError extends Error {
  constructor() {
    super("BLE NUS service not found");
    this.name = "BleNusServiceNotFoundError";
  }
}

/** No usable Bluetooth adapter (off or absent). */
export class BleUnavailableError extends Error {
  constructor() {
    super("Bluetooth adapter unavailable");
    this.name = "BleUnavailableError";
  }
}

/**
 * Chooser for a NUS peripheral. ESPHome advertises the node name, so the
 * chooser matches on the given names and, as a fallback, on the service
 * uuid (most firmware does not advertise it); the service must still be
 * listed as optional or GATT access to it is refused. Returns null when the
 * chooser is dismissed.
 */
export async function requestBleNusDevice(
  names: string[]
): Promise<BluetoothDevice | null> {
  // Chrome rejects the chooser with the same NotFoundError as a dismissal
  // when the adapter is off; ask first so that case gets its own message.
  if (typeof navigator.bluetooth.getAvailability === "function") {
    if (!(await navigator.bluetooth.getAvailability())) throw new BleUnavailableError();
  }
  const filters: BluetoothLEScanFilter[] = [
    ...[...new Set(names.filter(Boolean))].map((name) => ({ name })),
    { services: [BLE_NUS_SERVICE_UUID] },
  ];
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

export interface BleNusOptions {
  /** Connect attempts before giving up; a missing service is never retried. */
  attempts?: number;
  retryDelayMs?: number;
  /** Stops the retries once the session that asked for them is gone. */
  cancelled?: () => boolean;
}

/**
 * Connect to *device*, subscribe to NUS notifications and stream lines into
 * *hooks*. Resolves to a cancel (idempotent, also disconnects) once
 * notifications flow; throws the last connect error otherwise.
 */
export async function streamBleNus(
  device: BluetoothDevice,
  hooks: SerialLineHooks,
  { attempts = 1, retryDelayMs = 1000, cancelled = () => false }: BleNusOptions = {}
): Promise<() => void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await subscribe(device, hooks);
    } catch (err) {
      if (err instanceof BleNusServiceNotFoundError || attempt >= attempts) throw err;
      await sleep(retryDelayMs);
      if (cancelled()) throw err;
    }
  }
}

async function subscribe(
  device: BluetoothDevice,
  hooks: SerialLineHooks
): Promise<() => void> {
  const push = createLogLineAssembler(hooks.onLine);
  let txChar: BluetoothRemoteGATTCharacteristic | null = null;
  let detached = false;
  let streaming = false;
  const onValue = (): void => {
    const dv = txChar?.value;
    if (dv) push(dv);
  };
  // Chrome hands back the same characteristic object across sessions, so the
  // listeners must come off on every exit or they stack up.
  const detach = (): boolean => {
    if (detached) return false;
    detached = true;
    device.removeEventListener("gattserverdisconnected", onDisconnected);
    txChar?.removeEventListener("characteristicvaluechanged", onValue);
    txChar = null;
    return true;
  };
  // A drop during the subscribe surfaces as the subscribe failing below;
  // only a streaming link reports it as a disconnect.
  const onDisconnected = (): void => {
    if (detach() && streaming) hooks.onDisconnect?.();
  };
  device.addEventListener("gattserverdisconnected", onDisconnected);
  try {
    const server = await device.gatt!.connect();
    const service = await server
      .getPrimaryService(BLE_NUS_SERVICE_UUID)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "NotFoundError") {
          throw new BleNusServiceNotFoundError();
        }
        throw err;
      });
    txChar = await service.getCharacteristic(BLE_NUS_TX_UUID);
    txChar.addEventListener("characteristicvaluechanged", onValue);
    // Chrome caches its subscribed flag per characteristic; a device that
    // reset the CCCD on disconnect would otherwise never be re-subscribed.
    await txChar.stopNotifications().catch(() => {});
    await txChar.startNotifications();
    if (detached || !device.gatt?.connected) {
      throw new DOMException("The device disconnected while subscribing", "NetworkError");
    }
    streaming = true;
    return () => {
      if (detach()) device.gatt?.disconnect();
    };
  } catch (err) {
    // Leave nothing connected behind a failed attempt: a linked peripheral
    // stops advertising and burns radio budget.
    detach();
    device.gatt?.disconnect();
    throw err;
  }
}
