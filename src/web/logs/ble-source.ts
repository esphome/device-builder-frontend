/**
 * Bluetooth NUS as a log source: the shared ``streamBleNus`` engine behind
 * the dialog's reconnect loop. A dropped link gets a short grace period
 * before the first reconnect, since a peripheral that rebooted is not
 * advertising again straight away.
 */
import { BLE_CONNECT_ATTEMPTS, streamBleNus } from "../../platforms/nrf52/index.js";
import type { SerialLineHooks } from "../../util/serial-log-stream.js";
import { sleep } from "../../util/sleep.js";
import type { WebLogSource } from "./log-source.js";

const REATTACH_DELAY_MS = 1000;

export class BleLogSource implements WebLogSource {
  constructor(private readonly device: BluetoothDevice) {}

  attach(hooks: SerialLineHooks, cancelled: () => boolean): Promise<() => Promise<void>> {
    return streamBleNus(this.device, hooks, {
      attempts: BLE_CONNECT_ATTEMPTS,
      cancelled,
    });
  }

  async resume(
    hooks: SerialLineHooks,
    cancelled: () => boolean
  ): Promise<(() => Promise<void>) | null> {
    await sleep(REATTACH_DELAY_MS);
    if (cancelled()) return null;
    // A failed reconnect throws (a missing NUS service is a real reason to
    // show); the dialog prints it with the reconnect-failed line.
    return streamBleNus(this.device, hooks, {
      attempts: BLE_CONNECT_ATTEMPTS,
      cancelled,
    });
  }

  // The subscription's cancel disconnects; a dead link left nothing behind.
  release(): void {}
}
