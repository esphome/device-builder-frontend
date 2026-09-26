/** The Device Builder's nRF52 support: Nordic legacy DFU over the bootloader's CDC, and logs. */
import type { PlatformSupport } from "../platform-support.js";
import { pickBleNusDevice } from "./ble-nus-picker.js";
import {
  BLE_CONNECT_ATTEMPTS,
  BleNusServiceNotFoundError,
  isWebBluetoothSupported,
  streamBleNus,
} from "./ble-nus-stream.js";
import { nrfDfuInstall } from "./dfu-install.js";
import { isNrfPlatform } from "./nrf-platform.js";
import { NRF52_SERIAL_LOGS } from "./serial-logs.js";

export * from "./dfu-install.js";

export const nrf52Platform: PlatformSupport = {
  id: "nrf52",
  matches: isNrfPlatform,
  install: nrfDfuInstall,
  logs: {
    serial: NRF52_SERIAL_LOGS,
    ble: {
      available: isWebBluetoothSupported,
      pick: pickBleNusDevice,
      connect: (device, hooks, cancelled) =>
        streamBleNus(device, hooks, { attempts: BLE_CONNECT_ATTEMPTS, cancelled }),
      failureKey: (err) =>
        err instanceof BleNusServiceNotFoundError
          ? "dashboard.logs_ble_nus_service_not_found"
          : "dashboard.logs_ble_nus_open_failed",
    },
  },
};
