import { OTA_PORT } from "../api/types/streaming.js";
import type { LocalizeFunc } from "../common/localize.js";
import { streamSerialToDialog } from "../components/dashboard/actions.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import { fireRequestEvent } from "./fire-event.js";
import { resolveLogBaudRate } from "./log-baud-rate.js";
import { notifyError, notifyInfo } from "./notify.js";
import { serialConsoleMismatch } from "./serial-console-match.js";
import {
  isPortPickerCancel,
  openLiveSerialPort,
  SERIAL_REOPEN_TIMEOUT_MS,
} from "./web-serial.js";

/**
 * Route a device whose serial console is provably silent (logger baud_rate 0,
 * or a port that can't carry the console) to the network log stream, with a
 * notice saying why (#1430). The default message is the baud-0 one.
 */
export function openNetworkLogsFallback(
  logsDialog: ESPHomeLogsDialog,
  localize: LocalizeFunc,
  options: { onBackToInstall?: () => void; message?: string } = {}
): void {
  const { message, ...openOptions } = options;
  notifyInfo(message ?? localize("dashboard.logs_serial_disabled_fallback"));
  logsDialog.open(OTA_PORT, openOptions);
}

/**
 * Human label for a Web Serial port, for error messages. Web Serial exposes
 * no device path/name, only the USB vendor/product ids; fall back to a generic
 * label when those are absent (non-USB ports).
 */
export function formatSerialPortLabel(port: SerialPort): string {
  const { usbVendorId, usbProductId } = port.getInfo();
  if (usbVendorId === undefined || usbProductId === undefined) {
    return "unknown device";
  }
  const hex = (n: number) => n.toString(16).padStart(4, "0");
  return `USB ${hex(usbVendorId)}:${hex(usbProductId)}`;
}

/**
 * Prompt for a Web Serial port without opening it. Returns ``null`` if the
 * user dismissed the picker; throws on a real requestPort failure. Callers
 * that only need the USB identity can decide before ever opening (no DTR/RTS
 * pulse on a port that won't be used).
 */
export async function requestSerialPort(): Promise<SerialPort | null> {
  try {
    return await navigator.serial.requestPort();
  } catch (err) {
    if (isPortPickerCancel(err)) {
      return null; // User dismissed the port picker.
    }
    throw err; // A real requestPort failure — let the caller surface it.
  }
}

/**
 * Reconnect a dead Web Serial logs session by acquiring a FRESH port via the
 * picker, not reopening the cached handle.
 *
 * The post-install handoff caches the ``SerialPort`` esptool used for flashing;
 * on a native-USB chip (C3 / S3 / C6) the post-flash reset re-enumerates the
 * USB device and that download-mode handle never reopens. Re-running the picker
 * (the dialog's "Start" runs inside the click's user activation, so
 * ``requestPort()`` is allowed) grabs the running firmware's live CDC — the
 * same thing a manual "Logs → Web Serial" does, which is why that works.
 */
export async function reconnectWebSerialLogs(
  logsDialog: ESPHomeLogsDialog,
  localize: LocalizeFunc,
  baudRate: number,
  loggerInterface: string | null
): Promise<void> {
  let port: SerialPort | null;
  try {
    port = await requestSerialPort();
  } catch {
    const message = localize("dashboard.logs_web_serial_open_failed");
    logsDialog.setSerialOpenFailed(message);
    notifyError(message);
    return;
  }
  if (!port) {
    logsDialog.abortSerialReconnect(); // Picker dismissed — back to "Start", quietly.
    return;
  }
  // Same pre-open gate as the entry points, but this fires mid-session:
  // swap the source in place so the buffer and the back-to-install
  // affordance survive, rather than re-opening a fresh session.
  const mismatch = serialConsoleMismatch(loggerInterface, port, localize);
  if (mismatch) {
    notifyInfo(mismatch.message);
    logsDialog.switchToNetworkLogs(mismatch.message);
    return;
  }
  try {
    await port.open({ baudRate });
  } catch {
    const message = localize("dashboard.logs_web_serial_open_failed");
    logsDialog.setSerialOpenFailed(message);
    notifyError(message);
    return;
  }
  await attachSerialLogStream(port, logsDialog, localize, baudRate);
}

/**
 * Detail shape of the cancelable ``request-show-logs-after-install``
 * event dispatched by the install dialogs (command-dialog for OTA /
 * server-serial, firmware-install-dialog for Web Serial).
 *
 * ``port`` is set on the network / server-serial path. ``webSerialPort``
 * is set on the Web Serial path — the dispatching dialog disconnected
 * it for the install reset, and the handler reopens it at log baud.
 * Exactly one of those two is set per event. ``reopenInstall`` is the
 * callback the logs dialog's "Back to install" button invokes to
 * re-show the original install dialog with its preserved state.
 */
export interface PostInstallShowLogsDetail {
  configuration: string;
  name: string;
  port?: string;
  webSerialPort?: SerialPort;
  // Raw device logger baud_rate, only meaningful on the webSerialPort path.
  // The handler resolves it: null / absent ⇒ 115200 default, 0 ⇒ serial
  // logging disabled (skip with a notice).
  loggerBaudRate?: number | null;
  // Resolved logger output interface (Device.logger_interface), only
  // meaningful on the webSerialPort path: a port that can't carry it
  // reroutes to network logs.
  loggerInterface?: string | null;
  reopenInstall: () => void;
}

/**
 * Dispatch the cancelable ``request-show-logs-after-install`` event
 * from an install dialog. Returns ``true`` iff a host claimed the
 * handoff (called ``preventDefault()``) — the install dialog uses
 * that to decide whether to hide itself or stay open. Centralised
 * here so the two install dialogs (command-dialog for OTA / server-
 * serial, firmware-install-dialog for Web Serial) don't drift on
 * the event name, the ``cancelable`` flag, or the bubble shape.
 */
export function dispatchShowLogsAfterInstall(
  source: HTMLElement,
  detail: PostInstallShowLogsDetail
): boolean {
  return fireRequestEvent(source, "request-show-logs-after-install", detail);
}

/**
 * Shared handler for the install-dialog → logs-dialog hand-off.
 *
 * Pages that mount both install dialogs and a logs dialog
 * (dashboard, device editor) wire this onto each install dialog's
 * ``@request-show-logs-after-install``. The handler routes Web
 * Serial through ``openPassive`` + ``streamSerialToDialog`` (no
 * backend subprocess), and routes OTA / server-serial through
 * ``open(port)`` (the regular esphome-logs WS endpoint).
 *
 * Calls ``preventDefault()`` so the source dialog hides itself —
 * contexts that DON'T mount a logs dialog (e.g. firmware-jobs-dialog
 * for past-job replay) leave the source open instead of vanishing.
 */
/**
 * Bound-handler factory for the install → logs hand-off. Hosts that
 * mount an install dialog and a logs-dialog (dashboard, device
 * editor, firmware-tasks dialog) all reduce to the same one-liner:
 *
 *     private _onPostInstallShowLogs = postInstallShowLogsHandler(
 *       () => this._logsDialog,
 *       () => this._localize,
 *     );
 *
 * The getters are deferred so the host's ``@query`` and ``@consume``
 * decorators can resolve at event-fire time (after first render),
 * not at field-initialisation time when the shadow DOM hasn't been
 * rendered yet and the localize context hasn't been bound.
 */
export function postInstallShowLogsHandler(
  getLogsDialog: () => ESPHomeLogsDialog,
  getLocalize: () => LocalizeFunc
): (e: CustomEvent<PostInstallShowLogsDetail>) => Promise<void> {
  return (e) => handlePostInstallShowLogs(e, getLogsDialog(), getLocalize());
}

/**
 * Start a Web Serial read loop and hand the dialog its port + loop-cancel.
 * Begins a passive session (user-initiated logs, post-install hand-off, or
 * the dialog's reconnect-after-failure). A closed port is reopened through the
 * re-enumeration window — resolving the live granted handle, since a native-USB
 * chip's cached handle can be dead after the reset — with DTR/RTS cleared; an
 * already-open port streams as-is.
 */
export async function attachSerialLogStream(
  port: SerialPort,
  logsDialog: ESPHomeLogsDialog,
  localize: LocalizeFunc,
  baudRate: number
): Promise<void> {
  if (!port.readable) {
    const live = await openLiveSerialPort(port, {
      baudRate,
      timeoutMs: SERIAL_REOPEN_TIMEOUT_MS,
    });
    if (!live) {
      const message = localize("dashboard.logs_port_reopen_failed", {
        port: formatSerialPortLabel(port),
      });
      logsDialog.setSerialOpenFailed(message);
      notifyError(message);
      return;
    }
    port = live;
    try {
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch {
      /* setSignals failures are recoverable; the chip might be in a
         fine state already. Continue. */
    }
  }
  const cancel = streamSerialToDialog(port, logsDialog);
  logsDialog.setSerialStream(port, cancel);
}

export async function handlePostInstallShowLogs(
  e: CustomEvent<PostInstallShowLogsDetail>,
  logsDialog: ESPHomeLogsDialog,
  localize: LocalizeFunc
) {
  e.preventDefault();
  const {
    configuration,
    name,
    port,
    webSerialPort,
    loggerBaudRate,
    loggerInterface,
    reopenInstall,
  } = e.detail;
  logsDialog.configuration = configuration;
  logsDialog.name = name;
  if (webSerialPort) {
    const baudRate = resolveLogBaudRate(loggerBaudRate);
    if (baudRate === null) {
      openNetworkLogsFallback(logsDialog, localize, { onBackToInstall: reopenInstall });
      return;
    }
    const mismatch = serialConsoleMismatch(loggerInterface, webSerialPort, localize);
    if (mismatch) {
      openNetworkLogsFallback(logsDialog, localize, {
        onBackToInstall: reopenInstall,
        message: mismatch.message,
      });
      return;
    }
    logsDialog.openPassive({
      onBackToInstall: reopenInstall,
      // "click Start to reconnect" after a reopen failure (#636). Re-acquire a
      // fresh port via the picker rather than reopening the cached esptool
      // handle, which a native-USB chip's post-flash re-enumeration leaves dead.
      onReconnect: () =>
        reconnectWebSerialLogs(logsDialog, localize, baudRate, loggerInterface ?? null),
    });
    /* Settling delay — some USB-UART bridges (notably the CH9102F on
       M5Stamp boards) don't resync their internal CDC state cleanly
       when port.open() lands immediately after a port.close() within
       the same USB session. The reader then sees no bytes even though
       the chip is booting and outputting on UART. A few hundred ms is
       enough for the bridge to settle. */
    await new Promise((r) => setTimeout(r, 500));
    /* The install just left the port closed via ``resetAndDisconnect``;
       the attach reopens the still-granted port (retrying the native-USB
       re-enumeration window) and starts reading. */
    await attachSerialLogStream(webSerialPort, logsDialog, localize, baudRate);
  } else {
    logsDialog.open(port ?? OTA_PORT, { onBackToInstall: reopenInstall });
  }
}
