/**
 * Log streaming over the BLE Nordic UART Service (Web Bluetooth, Chromium
 * only). Lines go through the same assembler as Web Serial so both surfaces
 * render identically.
 */
import {
  createLogLineAssembler,
  safeFlush,
  type SerialLineHooks,
} from "../../util/serial-log-stream.js";
import { sleep } from "../../util/sleep.js";
import { isPortPickerCancel } from "../../util/web-serial.js";

export const BLE_NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
// TX characteristic: device -> host (notify).
const BLE_NUS_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

export const isWebBluetoothSupported = (): boolean => "bluetooth" in navigator;

/** Not usable: the radio is off or access denied ("off"), and on Brave the
 *  feature itself may also be switched off ("brave"). */
export type BleUnavailableReason = "off" | "brave";

// Pages cannot link to internal browser URLs, so the flag page is offered
// as an address for the user to copy and paste.
export const BRAVE_WEB_BLUETOOTH_FLAG = "brave://flags/#brave-web-bluetooth-api";

/**
 * Whether Bluetooth can be used right now, or why not. The API object alone
 * says nothing: the radio may be off or the browser denied access, and Brave
 * exposes it with the feature switched off; the adapter query answers for
 * all of those, and Brave is told apart so its extra step can be named.
 */
export async function bleUnavailableReason(): Promise<BleUnavailableReason | null> {
  if (await bleAdapterAvailable()) return null;
  return (await isBraveBrowser()) ? "brave" : "off";
}

/** The one place the adapter is asked; a rejection counts as unusable. */
async function bleAdapterAvailable(): Promise<boolean> {
  try {
    return await navigator.bluetooth.getAvailability();
  } catch {
    return false;
  }
}

/** Brave announces itself through `navigator.brave`. */
async function isBraveBrowser(): Promise<boolean> {
  const brave = (navigator as { brave?: { isBrave?: () => Promise<boolean> } }).brave;
  if (!brave?.isBrave) return false;
  try {
    return await brave.isBrave();
  } catch {
    return false;
  }
}

/** The picked device has no NUS service: the wrong device, not a bad link. */
export class BleNusServiceNotFoundError extends Error {
  constructor() {
    super("BLE NUS service not found");
    this.name = "BleNusServiceNotFoundError";
  }
}

/** No usable Bluetooth adapter (off or absent), with why for the hint. */
export class BleUnavailableError extends Error {
  constructor(readonly reason: BleUnavailableReason = "off") {
    super("Bluetooth adapter unavailable");
    this.name = "BleUnavailableError";
  }
}

/**
 * Chooser for a NUS peripheral. ESPHome advertises the node name, so the
 * chooser matches on the given names; with no name known at all it lists
 * every device. The service is listed as optional so GATT access to it is
 * granted after the user picks a device. Returns null when the chooser is
 * dismissed.
 */
export async function requestBleNusDevice(
  names: string[]
): Promise<BluetoothDevice | null> {
  const known = [...new Set(names.filter(Boolean))];
  const options: RequestDeviceOptions = known.length
    ? {
        filters: known.map((name) => ({ name })),
        optionalServices: [BLE_NUS_SERVICE_UUID],
      }
    : { acceptAllDevices: true, optionalServices: [BLE_NUS_SERVICE_UUID] };
  try {
    return await navigator.bluetooth.requestDevice(options);
  } catch (err) {
    if (!isPortPickerCancel(err)) throw err;
    // Chrome rejects with the same NotFoundError when the adapter is off.
    const reason = await bleUnavailableReason();
    if (reason) throw new BleUnavailableError(reason);
    // Also Chrome's answer when no device matched or policy blocked the
    // chooser, so leave a trace for "nothing happened" reports.
    console.debug("BLE NUS chooser closed", err);
    return null;
  }
}

/**
 * Connect attempts a logs session gives a NUS link: GATT connects fail
 * transiently while the device is still advertising or the OS stack settles
 * after a prior session.
 */
export const BLE_CONNECT_ATTEMPTS = 3;

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
