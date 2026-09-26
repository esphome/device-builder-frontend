import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import { releaseControlLines } from "../../util/serial-control-lines.js";
import { openFailureMessage } from "../../util/serial-open-error.js";
import { LOG_BAUD_RATE, LOG_BUFFER_SIZE } from "./serial-source.js";

/** Per-board line handling for a logs open. */
export interface LogsOpenOptions {
  /** Drop DTR and RTS right after the open (the RTL8720C's strap and reset lines). */
  releaseLines?: boolean;
}

/**
 * Open a port for the logs view before showing the dialog. Returns ``true`` if
 * the port is ready to stream. Opening here (in the caller's click gesture)
 * rather than inside the dialog keeps the failure path out of the dialog's
 * show/hide lifecycle. An already-open port (``InvalidStateError`` — a prior
 * action or reset race left it open) is fine; the dialog streams it as-is.
 */
export async function openPortForLogs(
  port: SerialPort,
  localize: LocalizeFunc,
  options: LogsOpenOptions = {}
): Promise<boolean> {
  try {
    await port.open({ baudRate: LOG_BAUD_RATE, bufferSize: LOG_BUFFER_SIZE });
    // Chromium asserts DTR and RTS on open; on the RTL8720C kits those are
    // the download strap and the reset, so drop them before the board boots.
    if (options.releaseLines) await releaseControlLines(port);
  } catch (err) {
    // ``InvalidStateError`` means the port is already open. That's fine ONLY if
    // nothing else holds its reader — streamSerialLines() calls getReader(), so
    // a locked readable stream (another action mid-op) would fail. Bail loudly.
    if (err instanceof DOMException && err.name === "InvalidStateError") {
      if (port.readable?.locked) {
        toast.error(localize("web.logs.port_busy"));
        return false;
      }
      // Left open by an earlier action, possibly with the lines still up.
      if (options.releaseLines) await releaseControlLines(port);
      return true;
    }
    toast.error(openFailureMessage(err, localize));
    return false;
  }
  return true;
}
