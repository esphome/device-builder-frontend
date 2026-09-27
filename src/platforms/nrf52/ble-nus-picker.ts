/**
 * The Bluetooth device chooser with its failures toasted: what both the
 * dashboard and ESPHome Web run from a "Bluetooth logs" click, and the
 * dashboard from a Bluetooth install. Null when there is nothing to open
 * (dismissed, unsupported, or the failure already shown).
 */
import type { LocalizeFunc } from "../../common/localize.js";
import { copyAddressToClipboard } from "../../util/copy-address.js";
import { LONG_TOAST_DURATION_MS, notifyError } from "../../util/notify.js";
import { openFailureMessage } from "../../util/serial-open-error.js";
import {
  BLE_NUS_SERVICE_UUID,
  BleUnavailableError,
  BRAVE_WEB_BLUETOOTH_FLAG,
  isWebBluetoothSupported,
  requestBleDevice,
} from "./ble-nus-stream.js";
import { SMP_BLE_SERVICE_UUID } from "./smp-ble-service.js";

// The NUS service is not advertised, but a build with the mcumgr OTA
// advertises that one, which finds the device under a name the OS has not
// caught up with.
export const pickBleNusDevice = (
  localize: LocalizeFunc,
  names: string[]
): Promise<BluetoothDevice | null> =>
  pickBleDevice(localize, names, BLE_NUS_SERVICE_UUID, [SMP_BLE_SERVICE_UUID]);

/** *advertised*: the services the device may advertise (``requestBleDevice``). */
export async function pickBleDevice(
  localize: LocalizeFunc,
  names: string[],
  service: string,
  advertised: readonly string[] = []
): Promise<BluetoothDevice | null> {
  if (!isWebBluetoothSupported()) {
    notifyError(localize("dashboard.logs_ble_nus_unsupported"));
    return null;
  }
  try {
    return await requestBleDevice(names, service, advertised);
  } catch (err) {
    console.warn("BLE chooser failed", err);
    if (!(err instanceof BleUnavailableError)) {
      notifyError(
        openFailureMessage(err, localize, "dashboard.logs_ble_nus_open_failed")
      );
    } else if (err.reason === "brave") {
      // Brave ships with the API switched off; name the flag page too, with
      // a copy action since no page can link to it.
      notifyError(localize("dashboard.logs_ble_nus_unavailable"), {
        description: `${localize("dashboard.logs_method_ble_nus_brave")} ${BRAVE_WEB_BLUETOOTH_FLAG}`,
        duration: LONG_TOAST_DURATION_MS,
        action: {
          label: localize("settings.remote_build_address_copy"),
          onClick: () => void copyAddressToClipboard(localize, BRAVE_WEB_BLUETOOTH_FLAG),
        },
      });
    } else {
      notifyError(localize("dashboard.logs_ble_nus_unavailable"));
    }
    return null;
  }
}
