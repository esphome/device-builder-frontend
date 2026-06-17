import { stripBase } from "../../util/base-path.js";
import { navigate } from "../../util/navigation.js";
import {
  consumePendingSerialSetup,
  markPendingSerialSetup,
} from "../../util/pending-serial-setup.js";

/**
 * Route the USB "Set it up" toast action to the dashboard.
 *
 * The serial-setup listener and the wizard live only on the dashboard;
 * there, dispatch the live event. Elsewhere stash the port and navigate
 * home so the dashboard resumes on mount. Clear the stash if the editor
 * / secrets leave guard vetoes (or throws on) the navigation, so a stale
 * port can't fire on a later, unrelated mount.
 */
export async function dispatchOrStashSerialSetup(port: SerialPort | null): Promise<void> {
  if (stripBase(window.location.pathname) === "/") {
    window.dispatchEvent(new CustomEvent("esphome-serial-setup", { detail: { port } }));
    return;
  }
  markPendingSerialSetup(port);
  try {
    await navigate("/");
  } catch {
    // A misbehaving leave guard threw; the veto-clear below still runs.
  }
  if (stripBase(window.location.pathname) !== "/") {
    consumePendingSerialSetup();
  }
}
