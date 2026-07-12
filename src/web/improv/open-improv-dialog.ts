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
// Match the flash/logs paths (and legacy): Chrome's 255-byte default overruns
// on bursty serial in a throttled tab.
const IMPROV_BUFFER_SIZE = 8192;

/** Outcome of an Improv provisioning session (mirrors the SDK ``closed`` detail). */
export interface ImprovResult {
  /** The device spoke the Improv service (its client was detected). */
  improv: boolean;
  /** Wi-Fi credentials were successfully provisioned on the device. */
  provisioned: boolean;
}

const NO_IMPROV: ImprovResult = { improv: false, provisioned: false };

/**
 * Delay before opening Improv after a first-time install/setup. Covers the
 * native install-dialog's hide animation (so Improv doesn't open behind its
 * backdrop) and gives a just-reset device time to re-enumerate and boot the new
 * firmware. Legacy slept 1s post-reset for the same reason.
 */
export const IMPROV_OPEN_DELAY_MS = 1000;

// Ports with an Improv session currently mounting/open. Guards a rapid
// double-click (e.g. "Configure Wi-Fi") from mounting two dialogs on one port —
// the second would fight the first for the port's reader/writer.
const activePorts = new WeakSet<SerialPort>();

/**
 * Open the Improv Wi-Fi serial provisioning dialog for an authorized port and
 * resolve once it closes. Returns whether the device spoke Improv and whether
 * Wi-Fi was provisioned.
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
): Promise<ImprovResult> {
  if (activePorts.has(port)) return NO_IMPROV;
  activePorts.add(port);
  try {
    return await runImprov(port, localize);
  } finally {
    activePorts.delete(port);
  }
}

async function runImprov(
  port: SerialPort,
  localize: LocalizeFunc
): Promise<ImprovResult> {
  // Track whether *we* opened the port, so on close we only release a port we
  // own — an already-open port belongs to whoever opened it.
  let weOpened = false;
  try {
    await port.open({ baudRate: IMPROV_BAUD_RATE, bufferSize: IMPROV_BUFFER_SIZE });
    weOpened = true;
  } catch (err) {
    // ``InvalidStateError`` means the port is already open. That's fine ONLY if
    // nothing else holds its reader/writer — the Improv SDK takes its own
    // reader + writer, so a locked stream (another consumer mid-op) would make
    // it fail cryptically. Surface a clear toast and bail in that case.
    if (err instanceof DOMException && err.name === "InvalidStateError") {
      if (port.readable?.locked || port.writable?.locked) {
        toast.error(localize("web.improv.port_busy"));
        return NO_IMPROV;
      }
    } else {
      toast.error(
        localize("web.improv.open_failed", {
          error: err instanceof Error ? err.message : String(err),
        })
      );
      return NO_IMPROV;
    }
  }

  // The SDK loads as a lazy chunk; a chunk-load / CSP / network failure here
  // would otherwise throw out of a ``void openImprovDialog(...)`` call as an
  // unhandled rejection and leave the port we opened dangling.
  try {
    await import("improv-wifi-serial-sdk/dist/serial-provision-dialog");
  } catch {
    if (weOpened) void port.close().catch(() => {});
    toast.error(localize("web.improv.load_failed"));
    return NO_IMPROV;
  }
  const dialog = document.createElement("improv-wifi-serial-provision-dialog");
  dialog.port = port;

  return new Promise<ImprovResult>((resolve) => {
    dialog.addEventListener(
      "closed",
      (ev: Event) => {
        const detail = (ev as CustomEvent<Partial<ImprovResult>>).detail ?? {};
        const result: ImprovResult = {
          improv: Boolean(detail.improv),
          provisioned: Boolean(detail.provisioned),
        };
        // Release the port only if we opened it. The SDK already cancelled its
        // reader in its own close handler, so this just frees the device for the
        // next action. Best-effort: the device may have been unplugged.
        if (weOpened) void port.close().catch(() => {});
        resolve(result);
      },
      { once: true }
    );
    document.body.appendChild(dialog);
  });
}
