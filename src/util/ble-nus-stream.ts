/**
 * Log streaming over the BLE Nordic UART Service (Web Bluetooth, Chromium
 * only). Lines go through the same assembler as Web Serial so both surfaces
 * render identically.
 */
import { isNrfPlatform } from "./nrf-platform.js";
import {
  createLogLineAssembler,
  safeFlush,
  type SerialLineHooks,
} from "./serial-log-stream.js";
import { sleep } from "./sleep.js";
import { isPortPickerCancel } from "./web-serial.js";

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
    if (!isPortPickerCancel(err)) throw err;
    // Chrome rejects with the same NotFoundError when the adapter is off.
    if (!(await navigator.bluetooth.getAvailability())) throw new BleUnavailableError();
    // Also Chrome's answer when no device matched or policy blocked the
    // chooser, so leave a trace for "nothing happened" reports.
    console.debug("BLE NUS chooser closed", err);
    return null;
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
 * notifications flow; throws the last connect error otherwise. Chooser
 * dismissal is told apart from an absent adapter only after the fact, so the
 * chooser itself opens inside the click's activation.
 */
export async function streamBleNus(
  device: BluetoothDevice,
  hooks: SerialLineHooks,
  { attempts = 1, retryDelayMs = 1000, cancelled = () => false }: BleNusOptions = {}
): Promise<() => Promise<void>> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await subscribe(device, hooks);
    } catch (err) {
      if (err instanceof BleNusServiceNotFoundError || attempt >= attempts) throw err;
      console.warn(`BLE NUS connect attempt ${attempt} of ${attempts} failed`, err);
      await sleep(retryDelayMs);
      if (cancelled()) throw err;
    }
  }
}

// A service or characteristic the device does not have means the wrong
// device was picked; anything else is a link problem worth a retry.
function wrongDevice(err: unknown): never {
  if (err instanceof DOMException && err.name === "NotFoundError") {
    throw new BleNusServiceNotFoundError();
  }
  throw err;
}

async function subscribe(
  device: BluetoothDevice,
  hooks: SerialLineHooks
): Promise<() => Promise<void>> {
  const assembler = createLogLineAssembler(hooks.onLine);
  let txChar: BluetoothRemoteGATTCharacteristic | null = null;
  let detached = false;
  const onValue = (): void => {
    const dv = txChar?.value;
    if (!dv) return;
    // A throw from the line sink would otherwise surface only as an uncaught
    // event-listener error while the session looked healthy.
    try {
      assembler.push(dv);
    } catch (err) {
      console.warn("Appending a BLE NUS log line failed", err);
    }
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
  const onDisconnected = (): void => {
    if (!detach()) return;
    safeFlush(assembler);
    hooks.onDisconnect?.();
  };
  try {
    const server = await device.gatt!.connect();
    const service = await server
      .getPrimaryService(BLE_NUS_SERVICE_UUID)
      .catch(wrongDevice);
    txChar = await service.getCharacteristic(BLE_NUS_TX_UUID).catch(wrongDevice);
    txChar.addEventListener("characteristicvaluechanged", onValue);
    // Chrome caches its subscribed flag per characteristic; a device that
    // reset the CCCD on disconnect would otherwise never be re-subscribed.
    await txChar.stopNotifications().catch((err: unknown) => {
      // Nothing subscribed is the usual answer; anything else may leave the
      // CCCD unwritten below, so it is worth a trace.
      console.warn("BLE NUS stopNotifications failed", err);
    });
    await txChar.startNotifications();
    // Nothing awaits from here to the return, so a drop either already
    // happened (the check below fails the subscribe) or reaches the listener.
    device.addEventListener("gattserverdisconnected", onDisconnected);
    if (!device.gatt?.connected) {
      throw new DOMException("The device disconnected while subscribing", "NetworkError");
    }
    // A caller's cancel means the session moved on: no late fragment.
    return async () => {
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
