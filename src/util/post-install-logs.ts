import type { ESPHomeCommandDialog } from "../components/command-dialog.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";

/**
 * Shared handler for the command-dialog → logs-dialog hand-off.
 *
 * The command-dialog dispatches ``request-show-logs-after-install``
 * when an install completes successfully and the user hasn't opted
 * out of the toolbar's "show logs after" toggle. Pages that mount
 * both dialogs (dashboard, device editor) wire this onto the
 * command-dialog and the matching ``handleLogsBackToInstall`` onto
 * the logs-dialog so the flip is symmetric.
 */
export function handlePostInstallShowLogs(
  e: CustomEvent<{ configuration: string; name: string; port: string }>,
  logsDialog: ESPHomeLogsDialog
) {
  const { configuration, name, port } = e.detail;
  logsDialog.configuration = configuration;
  logsDialog.name = name;
  logsDialog.open(port, { backToInstall: true });
}

/**
 * Reverse hand-off: the logs-dialog dispatches ``back-to-install``
 * when the user clicks its "Back to install" button. The command
 * dialog's state (line buffer, success banner) is preserved across
 * the flip so reopening is a pure show.
 */
export function handleLogsBackToInstall(commandDialog: ESPHomeCommandDialog) {
  commandDialog.reopen();
}
