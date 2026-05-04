import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import { streamSerialToDialog } from "../pages/dashboard-actions.js";

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
  const event = new CustomEvent("request-show-logs-after-install", {
    bubbles: true,
    composed: true,
    cancelable: true,
    detail,
  });
  return !source.dispatchEvent(event);
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
 *     );
 *
 * The getter is deferred so the host's ``@query`` decorator can
 * resolve the logs-dialog at event-fire time (after first render),
 * not at field-initialisation time when the shadow DOM hasn't been
 * rendered yet.
 */
export function postInstallShowLogsHandler(
  getLogsDialog: () => ESPHomeLogsDialog,
): (e: CustomEvent<PostInstallShowLogsDetail>) => Promise<void> {
  return (e) => handlePostInstallShowLogs(e, getLogsDialog());
}

export async function handlePostInstallShowLogs(
  e: CustomEvent<PostInstallShowLogsDetail>,
  logsDialog: ESPHomeLogsDialog
) {
  e.preventDefault();
  const { configuration, name, port, webSerialPort, reopenInstall } = e.detail;
  logsDialog.configuration = configuration;
  logsDialog.name = name;
  if (webSerialPort) {
    logsDialog.openPassive({ onBackToInstall: reopenInstall });
    /* Reopen the port at the logs baud — the install just left it
       closed via ``resetAndDisconnect``. The grant from the
       original ``requestPort()`` is still in effect for this
       origin, so this doesn't re-prompt the user. */
    try {
      await webSerialPort.open({ baudRate: 115200 });
    } catch {
      /* port might already be open if the user mashed buttons —
         streamSerialToDialog will surface its own error if read
         fails. */
    }
    const cancel = streamSerialToDialog(webSerialPort, logsDialog);
    logsDialog.setSerialCancel(cancel);
  } else {
    logsDialog.open(port ?? "OTA", { onBackToInstall: reopenInstall });
  }
}
