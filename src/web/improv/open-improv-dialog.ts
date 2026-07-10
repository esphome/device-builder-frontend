// Type-only import: pulls in the SDK's HTMLElementTagNameMap augmentation
// (so ``document.createElement`` is typed and ``.port`` is assignable) with no
// runtime cost. The element itself is registered by the dynamic import below,
// which rspack code-splits into its own chunk (it drags in the MWC component
// set, kept out of the entry bundle).
import type {} from "improv-wifi-serial-sdk/dist/serial-provision-dialog";
import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";

/** Baud rate the ESPHome Improv serial service speaks at. */
const IMPROV_BAUD_RATE = 115200;

/**
 * Open the Improv Wi-Fi serial provisioning dialog for an authorized port and
 * resolve once it closes (``true`` = the device was provisioned).
 *
 * The SDK's ``ImprovSerial`` reads ``port.readable`` / ``port.writable``
 * directly and throws "Port is not readable" on a closed port, so — unlike the
 * flash/logs paths — we open the port here before handing it over, then close
 * it when the dialog closes (the SDK only releases its reader, it doesn't own
 * the port). We must NOT remove the dialog ourselves: the SDK's ``_handleClose``
 * fires ``closed`` and then removes itself, so a second removal here nulls its
 * ``parentNode`` and crashes its ``removeChild``.
 */
export async function openImprovDialog(
  port: SerialPort,
  localize: LocalizeFunc
): Promise<boolean> {
  try {
    await port.open({ baudRate: IMPROV_BAUD_RATE });
  } catch (err) {
    // ``InvalidStateError`` means the port is already open. That's fine ONLY if
    // nothing else holds its reader/writer — the Improv SDK takes its own
    // reader + writer, so a locked stream (another consumer mid-op) would make
    // it fail cryptically. Surface a clear toast and bail in that case.
    if (err instanceof DOMException && err.name === "InvalidStateError") {
      if (port.readable?.locked || port.writable?.locked) {
        toast.error(localize("web.improv.port_busy"));
        return false;
      }
    } else {
      toast.error(
        localize("web.improv.open_failed", {
          error: err instanceof Error ? err.message : String(err),
        })
      );
      return false;
    }
  }

  // The SDK loads as a lazy chunk; a chunk-load / CSP / network failure here
  // would otherwise throw out of a ``void openImprovDialog(...)`` call as an
  // unhandled rejection and leave the port we opened dangling.
  try {
    await import("improv-wifi-serial-sdk/dist/serial-provision-dialog");
  } catch {
    void port.close().catch(() => {});
    toast.error(localize("web.improv.load_failed"));
    return false;
  }
  const dialog = document.createElement("improv-wifi-serial-provision-dialog");
  dialog.port = port;

  return new Promise<boolean>((resolve) => {
    dialog.addEventListener(
      "closed",
      (ev: Event) => {
        const provisioned = Boolean(
          (ev as CustomEvent<{ provisioned: boolean }>).detail?.provisioned
        );
        // Release the port we opened. The SDK already cancelled its reader in
        // its own close handler, so this just frees the device for the next
        // action. Best-effort: the device may have been unplugged.
        void port.close().catch(() => {});
        resolve(provisioned);
      },
      { once: true }
    );
    document.body.appendChild(dialog);
  });
}
