import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import type { SerialLogsPolicy } from "../../platforms/serial-logs.js";
import { getErrorMessage } from "../../util/error-message.js";
import { fireEvent } from "../../util/fire-event.js";
import { requestSerialPort } from "../../util/web-serial.js";
import { openPortForLogs } from "../logs/open-port-for-logs.js";
import { releaseOrphanedPort } from "./release-port.js";

/**
 * Open ``port`` for a card's logs dialog. ``false`` when it will not open (a
 * toast said why) or when ``host`` was unmounted meanwhile: a flow switch
 * accepted while the open was pending leaves nothing to own the port, so it
 * is released instead of handed to a dialog that no longer exists.
 */
export async function openLogsPortForCard(
  host: HTMLElement,
  port: SerialPort,
  localize: LocalizeFunc,
  policy: SerialLogsPolicy
): Promise<boolean> {
  if (!(await openPortForLogs(port, localize, policy))) return false;
  if (!host.isConnected) {
    await releaseOrphanedPort(port);
    return false;
  }
  return true;
}

/**
 * Pick a port in the click gesture and open it for a card's logs dialog;
 * ``null`` when the picker was dismissed, the pick or the open failed (a
 * toast said why), or the card was unmounted meanwhile. The picked port is
 * announced to the shell first, which may offer another board flow from
 * its ids.
 */
export async function pickPortForLogs(
  host: HTMLElement,
  localize: LocalizeFunc,
  policy: SerialLogsPolicy
): Promise<SerialPort | null> {
  let port: SerialPort | null;
  try {
    port = await requestSerialPort();
  } catch (err) {
    toast.error(localize("web.connect.failed", { error: getErrorMessage(err) }));
    return null;
  }
  if (!port) return null;
  fireEvent(host, "port-picked", port);
  return (await openLogsPortForCard(host, port, localize, policy)) ? port : null;
}
