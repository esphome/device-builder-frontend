/**
 * The Bluetooth (NUS) side of <esphome-web-logs-dialog>: connect, stream
 * through the dialog's line pipeline, and ride out a dropped link a few
 * times, as the dialog itself does for a serial re-enumeration.
 */
import { streamBleNus } from "../../util/ble-nus-stream.js";
import type { ESPHomeWebLogsDialog } from "./esphome-web-logs-dialog.js";

// Bluetooth links drop more readily than a cable; a connect gets a few tries.
const BLE_CONNECT_ATTEMPTS = 3;
// Consecutive reconnects that produced no line before giving up.
const BLE_MAX_SILENT_RECONNECTS = 3;

/**
 * Connect (or, after a drop, reconnect) and stream. Only the newest attempt
 * lands: a close or a newer drop bumps the dialog's generation.
 */
export async function attachBleLogs(
  host: ESPHomeWebLogsDialog,
  device: BluetoothDevice,
  resume: boolean
): Promise<void> {
  const gen = ++host._bleGen;
  if (!resume) {
    host._resetLines();
    host._crashKind = null;
    host._silentReconnects = 0;
  }
  host._paused = false;
  host._streaming = true;
  let cancel: () => Promise<void>;
  try {
    cancel = await streamBleNus(
      device,
      {
        onLine: (line) => {
          host._silentReconnects = 0;
          if (host._paused) return;
          host._observeCrash(line);
          host._enqueueLine(line);
        },
        onDisconnect: () => onBleDisconnect(host, device),
      },
      { attempts: BLE_CONNECT_ATTEMPTS, cancelled: () => gen !== host._bleGen }
    );
  } catch (err) {
    if (gen !== host._bleGen) return;
    host._streaming = false;
    host._enqueueLine(
      host._localize(
        resume ? "web.logs.reconnect_failed" : "web.logs.ble_connect_failed",
        {
          error: err instanceof Error ? err.message : String(err),
        }
      )
    );
    host._flushPending();
    return;
  }
  if (gen !== host._bleGen) {
    void cancel();
    return;
  }
  host._cancel = cancel;
  if (resume) {
    host._enqueueLine(host._localize("web.logs.reconnected"));
    host._enqueueLine("");
  }
}

/** The peripheral dropped the link on its own: say so, then try to get it back. */
export function onBleDisconnect(
  host: ESPHomeWebLogsDialog,
  device: BluetoothDevice
): void {
  host._enqueueLine("");
  host._enqueueLine("");
  host._enqueueLine(host._localize("web.logs.terminal_disconnected"));
  host._cancel = undefined;
  host._streaming = false;
  if (!host.open || ++host._silentReconnects > BLE_MAX_SILENT_RECONNECTS) {
    if (host.open) host._enqueueLine(host._localize("web.logs.reconnect_gave_up"));
    host._flushPending();
    return;
  }
  host._enqueueLine(host._localize("web.logs.reconnecting"));
  host._flushPending();
  void attachBleLogs(host, device, true);
}
