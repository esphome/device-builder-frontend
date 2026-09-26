/** The Device Builder's nRF52 logs policy: Web Serial without a reset line, and BLE NUS. */
import type { LogsSessionContext, PlatformLogs } from "../platform-support.js";
import { pickBleNusDevice } from "./ble-nus-picker.js";
import {
  BLE_CONNECT_ATTEMPTS,
  BleNusServiceNotFoundError,
  isWebBluetoothSupported,
  streamBleNus,
} from "./ble-nus-stream.js";

/**
 * The BLE twin of attaching a serial stream: a stream registered, or the
 * session dead with the reason in the pane. A remote disconnect goes dead
 * quietly (Start reconnects); a failed connect also toasts.
 */
export async function attachBleNusLogs(
  ctx: LogsSessionContext,
  device: BluetoothDevice,
  cancelled: () => boolean
): Promise<void> {
  let cancel: () => Promise<void>;
  try {
    cancel = await streamBleNus(
      device,
      {
        ...ctx.lineHooks,
        onDisconnect: () => ctx.end(ctx.localize("dashboard.logs_ble_nus_disconnected")),
      },
      { attempts: BLE_CONNECT_ATTEMPTS, cancelled }
    );
  } catch (err) {
    console.warn("BLE NUS connect failed", err);
    ctx.fail(
      ctx.localize(
        err instanceof BleNusServiceNotFoundError
          ? "dashboard.logs_ble_nus_service_not_found"
          : "dashboard.logs_ble_nus_open_failed"
      ),
      cancelled
    );
    return;
  }
  if (cancelled()) {
    void cancel();
    return;
  }
  ctx.setBleStream(cancel);
}

// The DFU-capable CDC has no reset line to pulse.
export const nrf52Logs: PlatformLogs = {
  serial: { pulseResets: false, releasesLinesAfterOpen: false },
  ble: {
    available: isWebBluetoothSupported,
    pick: pickBleNusDevice,
    attach: attachBleNusLogs,
  },
};
