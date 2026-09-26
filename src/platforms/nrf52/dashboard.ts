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
import { nrfResetFailureKey, rebootNrf } from "./nrf-logs-reset.js";
import { isNrfAppCdcPort, isNrfPlatform } from "./nrf-platform.js";

export * from "./dfu-install.js";

export const nrf52Platform: PlatformSupport = {
  id: "nrf52",
  matches: isNrfPlatform,
  install: nrfDfuInstall,
  logs: {
    serial: {
      // The DFU-capable CDC has no reset line to pulse; Reset device reboots
      // ESPHome through a 2001-baud touch instead, on its own CDC only.
      pulseResets: false,
      releasesLinesAfterOpen: false,
      reset: {
        available: () => true,
        supports: isNrfAppCdcPort,
        reboot: rebootNrf,
        failureKey: nrfResetFailureKey,
      },
    },
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
