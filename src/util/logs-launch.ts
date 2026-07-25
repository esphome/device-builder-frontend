import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import { resolveLogBaudRate } from "./log-baud-rate.js";
import { notifyError } from "./notify.js";
import {
  attachSerialLogStream,
  openNetworkLogsFallback,
  reconnectWebSerialLogs,
  requestSerialPort,
} from "./post-install-logs.js";
import { serialConsoleMismatch } from "./serial-console-match.js";

/** The host bits both logs entry points need, decoupled from any page class. */
export interface LogsLaunchHost {
  readonly api: ESPHomeAPI;
  readonly logsDialog: ESPHomeLogsDialog;
  readonly localize: LocalizeFunc;
}

/**
 * Open live logs, offering the OTA-vs-serial picker when a serial path exists.

 * ``openMethodPicker`` is invoked (host wires the picker in its logs mode) when
 * WebSerial or a server serial port is available; otherwise OTA logs open
 * directly. Online/offline state is intentionally not consulted (#525).
 */
export async function launchLogs(
  host: LogsLaunchHost,
  device: ConfiguredDevice,
  openMethodPicker: () => void
): Promise<void> {
  const hasWebSerial = "serial" in navigator;
  let hasServerPorts = false;
  if (!hasWebSerial) {
    // Only pay the backend round-trip when WebSerial can't already provide a
    // serial path.
    try {
      hasServerPorts = (await host.api.getSerialPorts()).length > 0;
    } catch (err) {
      // Lockstep deployment means this command exists, so a rejection is a real
      // WS/backend fault, not version drift; log it but still fall through to
      // OTA logs so the user isn't left without any path.
      console.warn("getSerialPorts failed; falling back to OTA logs", err);
      hasServerPorts = false;
    }
  }
  if (hasWebSerial || hasServerPorts) {
    openMethodPicker();
    return;
  }
  host.logsDialog.configuration = device.configuration;
  host.logsDialog.name = device.friendly_name || device.name;
  host.logsDialog.open();
}

/** Route a picked install-method to the logs dialog (OTA / server-serial / web-serial). */
export async function launchLogsWithMethod(
  host: LogsLaunchHost,
  device: ConfiguredDevice,
  method: string,
  port?: string
): Promise<void> {
  if (method === "ota") {
    host.logsDialog.configuration = device.configuration;
    host.logsDialog.name = device.friendly_name || device.name;
    host.logsDialog.open();
  } else if (method === "server-serial") {
    // server-serial always carries the chosen port; guard rather than let a
    // missing one fall through to open()'s OTA-sentinel default and silently
    // stream OTA logs (mirrors applyInstallMethod's server-serial guard).
    if (!port) return;
    host.logsDialog.configuration = device.configuration;
    host.logsDialog.name = device.friendly_name || device.name;
    host.logsDialog.open(port);
  } else if (method === "web-serial") {
    if (!("serial" in navigator)) {
      notifyError(host.localize("dashboard.logs_web_serial_unsupported"));
      return;
    }
    const baudRate = resolveLogBaudRate(device.logger_baud_rate);
    if (baudRate === null) {
      // Skip the port picker: the port would be silent.
      host.logsDialog.configuration = device.configuration;
      host.logsDialog.name = device.friendly_name || device.name;
      openNetworkLogsFallback(host.logsDialog, host.localize);
      return;
    }
    let serialPort: SerialPort | null;
    try {
      serialPort = await requestSerialPort();
    } catch {
      // A real requestPort failure; unlike a picker dismissal this needs
      // feedback.
      notifyError(host.localize("dashboard.logs_web_serial_open_failed"));
      return;
    }
    if (!serialPort) return; // User dismissed the port picker.
    host.logsDialog.configuration = device.configuration;
    host.logsDialog.name = device.friendly_name || device.name;
    // Decide on the unopened port (getInfo needs no open): a provably-silent
    // port is never opened, so no DTR/RTS pulse reaches a bridge that wires
    // them to reset lines.
    const mismatch = serialConsoleMismatch(
      device.logger_interface,
      serialPort,
      host.localize
    );
    if (mismatch) {
      openNetworkLogsFallback(host.logsDialog, host.localize, {
        message: mismatch.message,
      });
      return;
    }
    try {
      await serialPort.open({ baudRate });
    } catch {
      // The port couldn't open (claimed by another tab, driver error).
      notifyError(host.localize("dashboard.logs_web_serial_open_failed"));
      return;
    }
    // Reconnect (the dialog's "click Start to reconnect") re-acquires a fresh
    // port via the picker — the cached handle can be dead after a device reset.
    host.logsDialog.openPassive({
      onReconnect: () =>
        reconnectWebSerialLogs(
          host.logsDialog,
          host.localize,
          baudRate,
          device.logger_interface
        ),
    });
    // attach toasts the reopen-retry failure itself; cover any other rejection
    // so it can't escape this fire-and-forget call as an unhandled rejection.
    try {
      await attachSerialLogStream(serialPort, host.logsDialog, host.localize, baudRate);
    } catch {
      notifyError(host.localize("dashboard.logs_web_serial_open_failed"));
    }
  }
}
