/**
 * The boot logs after a receiver flash: the logs dialog opens at once (its
 * "Waiting…" placeholder covers the re-enumeration window) while the live
 * handle is acquired and opened; its 8k buffer holds the earliest boot bytes
 * until the dialog's reader attaches. Closing the dialog mid-wait does not
 * abort the acquisition; the handle still lands for the Logs button. Only a
 * newer install or an unmount supersedes it, via the host's generation.
 */
import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import { releaseControlLines } from "../../util/serial-control-lines.js";
import { LOG_BAUD_RATE } from "../logs/serial-source.js";
import { openLiveLogPort } from "./live-log-port.js";

// Native-USB chips re-enumerate on reset; wait this long for the running
// firmware's port to reappear before giving up on logs.
const LOG_REOPEN_TIMEOUT_MS = 8000;

/** The receiver's fields the acquisition reads and lands on. */
export interface BootLogsHost {
  _bootLogsGen: number;
  _logsOpen: boolean;
  _logPort?: SerialPort;
  _localize: LocalizeFunc;
}

/** Open the logs dialog on the rebooted device and land its port on the host. */
export async function acquireBootLogs(
  host: BootLogsHost,
  oldPort: SerialPort,
  before: SerialPort[]
): Promise<void> {
  const gen = ++host._bootLogsGen;
  host._logsOpen = true;
  const { port, error } = await openLiveLogPort(
    oldPort,
    before,
    LOG_BAUD_RATE,
    LOG_REOPEN_TIMEOUT_MS,
    () => gen !== host._bootLogsGen
  );
  if (!port) {
    if (gen === host._bootLogsGen) {
      // Announced even after the user closed the dialog: the alternative
      // is a silent dead end with no Logs button and no explanation.
      host._logsOpen = false;
      toast.error(
        host._localize("web.flash.logs_unavailable", {
          error: error ?? host._localize("web.flash.no_reenumerate"),
        })
      );
    }
    return;
  }
  // Clear DTR/RTS so holding the port open doesn't reset the chip.
  await releaseControlLines(port);
  // The stream can die during the await above (device yanked mid-hand-off);
  // a dead handle behind the dialog's "Waiting…" would never resolve.
  // Same contract as the !port branch: announced and parked regardless of
  // the dialog being open — openPortForLogs can often reopen a UA-closed
  // handle, so the Logs button stays a one-click recovery.
  if (!port.readable) {
    await port.close().catch(() => {});
    if (gen === host._bootLogsGen) {
      host._logsOpen = false;
      toast.error(
        host._localize("web.flash.logs_unavailable", {
          error: host._localize("web.logs.terminal_disconnected"),
        })
      );
      host._logPort = port;
    }
    return;
  }
  // Close the handle unless the open dialog is about to stream it (a
  // dialog closed mid-hand-off gets it back closed, so an accidental
  // Escape is a one-click recovery via the Logs button); park it unless
  // a newer install or an unmount superseded this acquisition.
  if (gen !== host._bootLogsGen || !host._logsOpen) {
    await port.close().catch(() => {});
  }
  if (gen === host._bootLogsGen) host._logPort = port;
}
