import type { LocalizeFunc } from "../../common/localize.js";
import type { SerialLogsPolicy } from "../../platforms/serial-logs.js";
import { openPortForLogs } from "../logs/open-port-for-logs.js";
import { pickPortForCard } from "./pick-port.js";
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
 * Pick a port (``pickPortForCard``) and open it for a card's logs dialog;
 * ``null`` when no port was picked, the open failed (a toast said why), or
 * the card was unmounted meanwhile.
 */
export async function pickPortForLogs(
  host: HTMLElement,
  localize: LocalizeFunc,
  policy: SerialLogsPolicy
): Promise<SerialPort | null> {
  const port = await pickPortForCard(host, localize);
  if (!port) return null;
  return (await openLogsPortForCard(host, port, localize, policy)) ? port : null;
}
