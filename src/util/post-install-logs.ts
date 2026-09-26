import { OTA_PORT } from "../api/types/streaming.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  dialogLineHooks,
  streamSerialToDialog,
} from "../components/dashboard/actions.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import type { SerialResetHook } from "../components/logs-dialog/session.js";
import type { BleLogsSupport } from "../platforms/platform-support.js";
import { serialLogsFor } from "../platforms/registry.js";
import { platformReset } from "../platforms/serial-logs.js";
import { releaseLinesAfterReopen } from "../platforms/serial-reopen.js";
import { formatUsbId } from "./flash-log.js";
import { resolveLogBaudRate } from "./log-baud-rate.js";
import { notifyError, notifyInfo } from "./notify.js";
import type { PostInstallShowLogsDetail } from "./post-install-dispatch.js";
import { serialConsoleMismatch } from "./serial-console-match.js";
import { releaseControlLines } from "./serial-control-lines.js";
import { openFailureMessage, openSerialPort } from "./serial-open-error.js";
import { openLiveSerialPort, SERIAL_REOPEN_TIMEOUT_MS } from "./serial-reacquire.js";
import { requestSerialPort } from "./web-serial.js";

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

// Ends the passive session with the cause in the pane (Start reconnects) and
// toasts it; not once the session moved on, since a newer session is not
// this failure's.
function failSerialOpen(
  logsDialog: ESPHomeLogsDialog,
  message: string,
  cancelled: () => boolean = () => false
): void {
  if (cancelled()) return;
  logsDialog.setSerialOpenFailed(message);
  notifyError(message);
}

function failPortReopen(
  logsDialog: ESPHomeLogsDialog,
  localize: LocalizeFunc,
  port: SerialPort,
  cancelled?: () => boolean
): void {
  failSerialOpen(
    logsDialog,
    localize("dashboard.logs_port_reopen_failed", { port: formatSerialPortLabel(port) }),
    cancelled
  );
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
  return `USB ${formatUsbId(usbVendorId, usbProductId)}`;
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
  loggerInterface: string | null,
  cancelled: () => boolean = () => false,
  targetPlatform = ""
): Promise<void> {
  let port: SerialPort | null;
  try {
    port = await requestSerialPort();
  } catch {
    failSerialOpen(
      logsDialog,
      localize("dashboard.logs_web_serial_open_failed"),
      cancelled
    );
    return;
  }
  // A pick that lands after the session moved on must not touch the newer one.
  if (cancelled()) return;
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
    await openPortForLogs(port, baudRate, targetPlatform);
  } catch (err) {
    failSerialOpen(logsDialog, openFailureMessage(err, localize), cancelled);
    return;
  }
  await attachSerialLogStream(
    port,
    logsDialog,
    localize,
    baudRate,
    cancelled,
    targetPlatform
  );
}

/** Open ``port`` for a logs session and apply the platform's line policy; rejects as ``open`` does. */
export async function openPortForLogs(
  port: SerialPort,
  baudRate: number,
  targetPlatform: string | null | undefined
): Promise<void> {
  await openSerialPort(port, { baudRate });
  if (serialLogsFor(targetPlatform).releaseLinesAfterOpen) {
    await releaseControlLines(port);
  }
}

/**
 * The platform's own Reset Device for a Web Serial logs session, or
 * undefined where the dialog's RTS pulse applies or the platform's reset
 * can't run in this browser (which hides the button).
 */
export function sessionResetHook(
  logsDialog: ESPHomeLogsDialog,
  localize: LocalizeFunc,
  targetPlatform: string | null | undefined,
  baudRate: number
): SerialResetHook | undefined {
  const support = platformReset(serialLogsFor(targetPlatform));
  if (!support?.available()) return undefined;
  return {
    supports: (port) => support.supports(port),
    run: async (port, cancelled) => {
      let live: SerialPort | null = null;
      let failure: string | undefined;
      try {
        // The reboot re-enumerates the port; null when it never came back.
        if (await support.reboot(port, cancelled)) {
          live = await openLiveSerialPort(port, { baudRate, cancelled });
        }
      } catch (err) {
        console.warn("Reset Device failed", err);
        failure = localize(support.failureKey(err) ?? "dashboard.logs_reset_failed");
      }
      if (failure) {
        // A stranded device still gets its toast once the session moved on,
        // but a newer session must not be flipped dead.
        if (cancelled()) notifyError(failure);
        else failSerialOpen(logsDialog, failure);
      } else if (!live) {
        failPortReopen(logsDialog, localize, port, cancelled);
      } else {
        await attachSerialLogStream(
          live,
          logsDialog,
          localize,
          baudRate,
          cancelled,
          targetPlatform
        );
      }
    },
  };
}

/**
 * The Bluetooth twin of ``attachSerialLogStream``: a stream registered, or
 * the session dead with the reason in the pane. A remote disconnect goes dead
 * quietly (Start reconnects); a failed connect also toasts.
 */
export async function attachBleLogs(
  dialog: ESPHomeLogsDialog,
  localize: LocalizeFunc,
  ble: BleLogsSupport,
  device: BluetoothDevice,
  cancelled: () => boolean
): Promise<void> {
  let cancel: () => Promise<void>;
  try {
    cancel = await ble.connect(
      device,
      {
        ...dialogLineHooks(dialog),
        onDisconnect: () =>
          dialog.setSerialOpenFailed(localize("dashboard.logs_ble_nus_disconnected")),
      },
      cancelled
    );
  } catch (err) {
    console.warn("Bluetooth logs connect failed", err);
    failSerialOpen(dialog, localize(ble.failureKey(err)), cancelled);
    return;
  }
  if (cancelled()) {
    void cancel();
    return;
  }
  dialog.setBleStream(cancel);
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
 * chip's cached handle can be dead after the reset — with DTR/RTS cleared
 * unless the board keeps them (``releaseLinesAfterReopen``); an already-open
 * port streams as-is.
 */
export async function attachSerialLogStream(
  port: SerialPort,
  logsDialog: ESPHomeLogsDialog,
  localize: LocalizeFunc,
  baudRate: number,
  cancelled: () => boolean = () => false,
  // Required, so a new caller can't forget it: it decides whether a reopen
  // drops DTR, which would silence an RP2 board's CDC.
  targetPlatform: string | null | undefined
): Promise<void> {
  if (!port.readable) {
    const live = await openLiveSerialPort(port, {
      baudRate,
      timeoutMs: SERIAL_REOPEN_TIMEOUT_MS,
      cancelled,
    });
    if (!live) {
      failPortReopen(logsDialog, localize, port, cancelled);
      return;
    }
    port = live;
    await releaseLinesAfterReopen(port, serialLogsFor(targetPlatform), targetPlatform);
  }
  if (cancelled()) {
    // The session moved on while the port was reopened; nothing will read it.
    await port.close().catch(() => {});
    return;
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
    targetPlatform,
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
    const cancelled = logsDialog.openPassive({
      onBackToInstall: reopenInstall,
      // "click Start to reconnect" after a reopen failure (#636). Re-acquire a
      // fresh port via the picker rather than reopening the cached esptool
      // handle, which a native-USB chip's post-flash re-enumeration leaves dead.
      onReconnect: (cancelled) =>
        reconnectWebSerialLogs(
          logsDialog,
          localize,
          baudRate,
          loggerInterface ?? null,
          cancelled,
          targetPlatform ?? ""
        ),
      onResetDevice: sessionResetHook(logsDialog, localize, targetPlatform, baudRate),
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
    await attachSerialLogStream(
      webSerialPort,
      logsDialog,
      localize,
      baudRate,
      cancelled,
      targetPlatform
    );
  } else {
    logsDialog.open(port ?? OTA_PORT, { onBackToInstall: reopenInstall });
  }
}
