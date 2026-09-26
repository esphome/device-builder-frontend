import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import { OTA_PORT } from "../api/types/streaming.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import { platformFor } from "../platforms/registry.js";
import { resolveLogBaudRate } from "./log-baud-rate.js";
import { notifyError, notifyInfo } from "./notify.js";
import {
  attachBleLogs,
  attachSerialLogStream,
  openNetworkLogsFallback,
  openPortForLogs,
  reconnectWebSerialLogs,
  sessionResetHook,
} from "./post-install-logs.js";
import { serialConsoleMismatch } from "./serial-console-match.js";
import { openFailureMessage } from "./serial-open-error.js";
import { requestSerialPort } from "./web-serial.js";

/** The host bits both logs entry points need, decoupled from any page class. */
export interface LogsLaunchHost {
  readonly api: ESPHomeAPI;
  readonly logsDialog: ESPHomeLogsDialog;
  readonly localize: LocalizeFunc;
}

// Upper bound on the serial-port probe so a degraded link opens OTA logs
// after a short beat instead of blocking silently on the 10s command timeout.
const SERIAL_PORT_PROBE_TIMEOUT_MS = 2500;

/**
 * Open live logs, offering the OTA-vs-serial picker when a serial path exists.

 * ``openMethodPicker`` is invoked (host wires the picker in its logs mode) when
 * WebSerial, a server serial port or Bluetooth logs are available; otherwise OTA logs open
 * directly. Online/offline state is intentionally not consulted (#525).
 */
export async function launchLogs(
  host: LogsLaunchHost,
  device: ConfiguredDevice,
  openMethodPicker: () => void
): Promise<void> {
  const hasWebSerial = "serial" in navigator;
  const hasBleNus = platformFor(device.target_platform)?.logs?.ble?.available() ?? false;
  let hasServerPorts = false;
  if (!hasWebSerial) {
    // Only pay the backend round-trip when WebSerial can't already provide a
    // serial path.
    try {
      hasServerPorts =
        (await host.api.getSerialPorts(SERIAL_PORT_PROBE_TIMEOUT_MS)).length > 0;
    } catch (err) {
      // Lockstep deployment means this command exists, so a rejection is a real
      // WS/backend fault or the bounded probe timing out on a degraded link;
      // either way fall through to OTA logs so the user isn't left without any
      // path. Neither failure is an answer, though: say the probe was skipped
      // rather than let the serial option silently disappear for someone who
      // has a serial device.
      console.warn("getSerialPorts failed; falling back to OTA logs", err);
      notifyInfo(host.localize("dashboard.logs_serial_probe_failed"));
      hasServerPorts = false;
    }
  }
  if (hasWebSerial || hasServerPorts || hasBleNus) {
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
    // 'port' carries the user-typed address override from the picker's
    // expanded form; without it the OTA sentinel targets the default
    // address (mirrors applyInstallMethod's ota case).
    host.logsDialog.open(port ?? OTA_PORT);
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
      await openPortForLogs(serialPort, baudRate, device.target_platform);
    } catch (err) {
      // The port couldn't open (claimed by another tab, driver error).
      notifyError(openFailureMessage(err, host.localize));
      return;
    }
    // Reconnect (the dialog's "click Start to reconnect") re-acquires a fresh
    // port via the picker — the cached handle can be dead after a device reset.
    const cancelled = host.logsDialog.openPassive({
      onReconnect: (cancelled) =>
        reconnectWebSerialLogs(
          host.logsDialog,
          host.localize,
          baudRate,
          device.logger_interface,
          cancelled,
          device.target_platform
        ),
      onResetDevice: sessionResetHook(
        host.logsDialog,
        host.localize,
        device.target_platform,
        baudRate
      ),
    });
    // attach toasts the reopen-retry failure itself; cover any other rejection
    // so it can't escape this fire-and-forget call as an unhandled rejection.
    try {
      await attachSerialLogStream(
        serialPort,
        host.logsDialog,
        host.localize,
        baudRate,
        cancelled,
        device.target_platform
      );
    } catch {
      notifyError(host.localize("dashboard.logs_web_serial_open_failed"));
    }
  } else if (method === "ble-nus") {
    const ble = platformFor(device.target_platform)?.logs?.ble;
    if (!ble) return;
    // The firmware advertises the node name; the friendly name is a guess.
    const bleDevice = await ble.pick(host.localize, [device.name, device.friendly_name]);
    if (!bleDevice) return;
    host.logsDialog.configuration = device.configuration;
    host.logsDialog.name = device.friendly_name || device.name;
    const cancelled = host.logsDialog.openPassive({
      source: "ble",
      onReconnect: (cancelled) =>
        attachBleLogs(host.logsDialog, host.localize, ble, bleDevice, cancelled),
    });
    // attach reports its own failures; cover any other rejection so it can't
    // escape this fire-and-forget call as an unhandled rejection.
    try {
      await attachBleLogs(host.logsDialog, host.localize, ble, bleDevice, cancelled);
    } catch (err) {
      console.warn("Bluetooth logs attach failed", err);
      notifyError(host.localize(ble.failureKey(err)));
    }
  }
}
