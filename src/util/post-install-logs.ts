import toast from "sonner-js";
import type { LocalizeFunc } from "../common/localize.js";
import { streamSerialToDialog } from "../components/dashboard/actions.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import { OTA_PORT } from "../components/logs-session.js";
import { isPortPickerCancel, SERIAL_ACTIVITY_WINDOW_MS } from "./web-serial.js";

// Reopen budget for a port closed by the post-install reset: covers the
// native-USB re-enumeration window (``SERIAL_ACTIVITY_WINDOW_MS``) with margin
// for a slower first enumeration on a brand-new board.
const SERIAL_REOPEN_TIMEOUT_MS = SERIAL_ACTIVITY_WINDOW_MS + 2000;

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
 * Prompt for a Web Serial port and open it at log baud. Returns the open port,
 * or ``null`` if the user dismissed the picker. Throws if a picked port can't
 * be opened (claimed by another tab, driver error) — the caller surfaces that.
 */
export async function requestAndOpenSerialPort(): Promise<SerialPort | null> {
  let port: SerialPort;
  try {
    port = await navigator.serial.requestPort();
  } catch (err) {
    if (isPortPickerCancel(err)) {
      return null; // User dismissed the port picker.
    }
    throw err; // A real requestPort failure — let the caller surface it.
  }
  await port.open({ baudRate: 115200 });
  return port;
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
  localize: LocalizeFunc
): Promise<void> {
  let port: SerialPort | null;
  try {
    port = await requestAndOpenSerialPort();
  } catch {
    const message = localize("dashboard.logs_web_serial_open_failed");
    logsDialog.setSerialOpenFailed(message);
    toast.error(message, { richColors: true });
    return;
  }
  if (!port) {
    logsDialog.abortSerialReconnect(); // Picker dismissed — back to "Start", quietly.
    return;
  }
  await attachSerialLogStream(port, logsDialog, localize);
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
  getLocalize: () => LocalizeFunc
): (e: CustomEvent<PostInstallShowLogsDetail>) => Promise<void> {
  return (e) => handlePostInstallShowLogs(e, getLogsDialog(), getLocalize());
}

// Same USB device by vendor/product id. Requires both ids present so two
// non-USB ports (``undefined === undefined``) aren't treated as a match.
// VID:PID isn't a unique device id — two identical boards both match and
// getPorts() order picks one; Web Serial exposes no per-device serial to
// disambiguate, and the post-install flow is single-device anyway.
const matchesDevice = (a: SerialPortInfo, b: SerialPortInfo): boolean =>
  a.usbVendorId !== undefined &&
  a.usbProductId !== undefined &&
  a.usbVendorId === b.usbVendorId &&
  a.usbProductId === b.usbProductId;

/**
 * Open the live SerialPort for a device the post-install hard-reset just
 * closed, retrying through the native-USB re-enumeration window. Returns the
 * open port, or ``null`` if none opened inside ``timeoutMs``.
 *
 * ESP32-S3 / C3 / C6 (USB-Serial/JTAG) drop their USB device after the reset
 * and re-enumerate. On Chrome the *cached* handle esptool used stays dead
 * (``open()`` throws ``NetworkError`` forever) while ``navigator.serial.
 * getPorts()`` returns a fresh, openable handle for the same authorized
 * device — so each attempt prefers a live granted port, falling back to the
 * cached handle (which Firefox and non-re-enumerating UART bridges reopen
 * directly). No re-prompt: every candidate is already permitted.
 */
async function openLiveSerialPort(
  cachedPort: SerialPort,
  baudRate: number,
  timeoutMs: number
): Promise<SerialPort | null> {
  const want = cachedPort.getInfo();
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (true) {
    let granted: SerialPort[] = [];
    try {
      granted = await navigator.serial.getPorts();
    } catch {
      /* getPorts can transiently reject mid-re-enumeration; treat as empty
         and retry (the cached handle is still tried below). */
    }
    // Prefer a freshly-granted handle for the same device (Chrome's live
    // re-enumerated port), then the cached handle (Firefox / UART bridges
    // reopen it in place). The cached handle is dropped from the granted list
    // so it isn't tried twice per round.
    const candidates = [
      ...granted.filter((p) => p !== cachedPort && matchesDevice(p.getInfo(), want)),
      cachedPort,
    ];
    for (const p of candidates) {
      if (p.readable) return p; // already open (a reset race left it usable)
      try {
        await p.open({ baudRate });
        return p;
      } catch (err) {
        lastErr = err;
        const name = err instanceof DOMException ? err.name : "";
        const message = err instanceof Error ? err.message : "";
        // Already open (a reset race / another candidate) — usable as-is.
        if (name === "InvalidStateError" && /already open/i.test(message)) {
          return p;
        }
        // NetworkError means the device is still gone mid-re-enumeration: keep
        // retrying the next candidate / round. Anything else (claimed by
        // another app, driver / security error) won't fix itself by waiting —
        // fail fast rather than stall the whole window behind a misleading
        // "still restarting" message.
        if (name !== "NetworkError") {
          console.error("[Web Serial] Failed to reopen port for logs:", err);
          return null;
        }
      }
    }
    if (Date.now() >= deadline) {
      console.error("[Web Serial] Failed to reopen port for logs:", lastErr);
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
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
  localize: LocalizeFunc
): Promise<void> {
  if (!port.readable) {
    const live = await openLiveSerialPort(port, 115200, SERIAL_REOPEN_TIMEOUT_MS);
    if (!live) {
      const message = localize("dashboard.logs_port_reopen_failed", {
        port: formatSerialPortLabel(port),
      });
      logsDialog.setSerialOpenFailed(message);
      toast.error(message, { richColors: true });
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
  const { configuration, name, port, webSerialPort, reopenInstall } = e.detail;
  logsDialog.configuration = configuration;
  logsDialog.name = name;
  if (webSerialPort) {
    logsDialog.openPassive({
      onBackToInstall: reopenInstall,
      // "click Start to reconnect" after a reopen failure (#636). Re-acquire a
      // fresh port via the picker rather than reopening the cached esptool
      // handle, which a native-USB chip's post-flash re-enumeration leaves dead.
      onReconnect: () => reconnectWebSerialLogs(logsDialog, localize),
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
    await attachSerialLogStream(webSerialPort, logsDialog, localize);
  } else {
    logsDialog.open(port ?? OTA_PORT, { onBackToInstall: reopenInstall });
  }
}
