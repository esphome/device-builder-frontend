import toast from "sonner-js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import { streamSerialToDialog } from "../components/dashboard/actions.js";

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
  getLocalize: () => LocalizeFunc,
): (e: CustomEvent<PostInstallShowLogsDetail>) => Promise<void> {
  return (e) => handlePostInstallShowLogs(e, getLogsDialog(), getLocalize());
}

/**
 * Reopen a SerialPort that the post-install hard-reset just closed,
 * retrying through the brief native-USB re-enumeration window.
 *
 * ESP32-S3 / C3 / C6 (USB-Serial/JTAG) drop their USB device for a
 * few hundred ms after the EN-pulse reset, so a synchronous
 * ``port.open()`` immediately after ``transport.disconnect()`` races
 * the re-enumeration and throws ``NetworkError``. UART-bridge chips
 * (CP2102 / CH340) don't re-enumerate and the first attempt succeeds.
 *
 * Returns ``true`` on success (or "already open" — a race that left
 * the port usable). Returns ``false`` if no attempt succeeded inside
 * ``timeoutMs``.
 */
async function openSerialWithRetry(
  port: SerialPort,
  baudRate: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (true) {
    try {
      await port.open({ baudRate });
      return true;
    } catch (err) {
      lastErr = err;
      const name = err instanceof DOMException ? err.name : "";
      const message = err instanceof Error ? err.message : "";
      // Chrome's message for "InvalidStateError: The port is already
      // open." has no specific DOMException code; string-match is
      // unavoidable. Web Serial is Chromium-only today so the surface
      // is one-browser — acceptable.
      if (name === "InvalidStateError" && /already open/i.test(message)) {
        return true;
      }
      if (name !== "NetworkError" || Date.now() >= deadline) {
        console.error("[Web Serial] Failed to reopen port for logs:", lastErr);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

export async function handlePostInstallShowLogs(
  e: CustomEvent<PostInstallShowLogsDetail>,
  logsDialog: ESPHomeLogsDialog,
  localize: LocalizeFunc,
) {
  e.preventDefault();
  const { configuration, name, port, webSerialPort, reopenInstall } = e.detail;
  logsDialog.configuration = configuration;
  logsDialog.name = name;
  if (webSerialPort) {
    logsDialog.openPassive({ onBackToInstall: reopenInstall });
    /* Settling delay — some USB-UART bridges (notably the CH9102F on
       M5Stamp boards) don't resync their internal CDC state cleanly
       when port.open() lands immediately after a port.close() within
       the same USB session. The reader then sees no bytes even though
       the chip is booting and outputting on UART. A few hundred ms is
       enough for the bridge to settle. */
    await new Promise((r) => setTimeout(r, 500));
    /* Reopen the port at the logs baud — the install just left it
       closed via ``resetAndDisconnect``. The grant from the
       original ``requestPort()`` is still in effect for this
       origin, so this doesn't re-prompt the user. Retry through
       the native-USB re-enumeration window. */
    const opened = await openSerialWithRetry(webSerialPort, 115200, 5000);
    if (!opened) {
      const message = localize("dashboard.logs_port_reopen_failed");
      logsDialog.setSerialOpenFailed(message);
      toast.error(message, { richColors: true });
      return;
    }
    /* Explicitly clear DTR/RTS — on some bridges (CH9102F again)
       these can stick at unexpected values across a close/reopen,
       and a residual asserted DTR can hold the strap pin / EN line
       low and keep the chip mute. */
    try {
      await webSerialPort.setSignals({
        dataTerminalReady: false,
        requestToSend: false,
      });
    } catch {
      /* setSignals failures are recoverable; the chip might be in
         a fine state already. Continue. */
    }
    const cancel = streamSerialToDialog(webSerialPort, logsDialog);
    logsDialog.setSerialCancel(cancel);
  } else {
    logsDialog.open(port ?? "OTA", { onBackToInstall: reopenInstall });
  }
}
