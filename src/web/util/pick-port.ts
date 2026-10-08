import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import { fireEvent } from "../../util/fire-event.js";
import { openFailureMessage } from "../../util/serial-open-error.js";
import { requestSerialPort } from "../../util/web-serial.js";

/**
 * Pick a port in the click gesture and announce it to the shell, which may
 * offer another board flow from its ids; ``null`` when the picker was
 * dismissed or failed (a toast said why).
 */
export async function pickPortForCard(
  host: HTMLElement,
  localize: LocalizeFunc
): Promise<SerialPort | null> {
  let port: SerialPort | null;
  try {
    port = await requestSerialPort();
  } catch (err) {
    toast.error(openFailureMessage(err, localize, "web.connect.failed"));
    return null;
  }
  if (port) fireEvent(host, "port-picked", port);
  return port;
}
