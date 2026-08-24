// Type-only import: pulls in the SDK's HTMLElementTagNameMap augmentation
// (so ``document.createElement`` is typed and ``.port`` is assignable) with no
// runtime cost. The element itself is registered by the dynamic import below,
// which rspack code-splits into its own chunk (it drags in the MWC component
// set, kept out of the entry bundle).
import type {} from "improv-wifi-serial-sdk/dist/serial-provision-dialog";
import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import { openLiveSerialPort } from "../../util/web-serial.js";

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

export interface ImprovOptions {
  /**
   * Called when the session had to reopen on a different handle than the one
   * passed in (a native-USB chip re-enumerated after its post-flash reset).
   * The card should adopt it for its other actions; see ``port-replaced``.
   */
  onPortReplaced?: (port: SerialPort) => void;
}

/**
 * Delay before opening Improv after a first-time install/setup. Covers the
 * native install-dialog's hide animation so Improv doesn't open behind its
 * backdrop. Riding out the post-reset USB re-enumeration is NOT this delay's
 * job: ``runImprov`` reopens through ``openLiveSerialPort``, which retries
 * until a live handle opens.
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
  localize: LocalizeFunc,
  options: ImprovOptions = {}
): Promise<ImprovResult> {
  if (activePorts.has(port)) return NO_IMPROV;
  activePorts.add(port);
  try {
    return await runImprov(port, localize, options);
  } finally {
    activePorts.delete(port);
  }
}

/**
 * Resolve an open, unlocked port for the SDK. An already-open port belongs to
 * whoever opened it and is used as-is (``weOpened`` false) unless another
 * consumer holds its streams. A closed one is reopened through
 * ``openLiveSerialPort``: right after a flash the device has just been reset,
 * and a native-USB chip (ESP32-C6 / S3 / C3 …) drops off the bus and comes
 * back as a *new* handle, so a bare ``port.open()`` on the cached handle races
 * the re-enumeration (#1678). ``weOpened`` is true only for a handle that
 * call actually opened, so a candidate it found already open is never closed
 * out from under its owner. DTR / RTS are cleared after opening so an
 * auto-reset circuit on a UART-bridge board isn't left holding EN low.
 */
async function acquirePort(
  port: SerialPort,
  localize: LocalizeFunc
): Promise<{ port: SerialPort; weOpened: boolean } | null> {
  if (port.readable) {
    if (port.readable.locked || port.writable?.locked) {
      toast.error(localize("web.improv.port_busy"));
      return null;
    }
    return { port, weOpened: false };
  }
  let weOpened = false;
  const live = await openLiveSerialPort(port, {
    baudRate: IMPROV_BAUD_RATE,
    bufferSize: IMPROV_BUFFER_SIZE,
    onOpened: () => {
      weOpened = true;
    },
  });
  if (!live) {
    toast.error(localize("web.improv.open_failed"));
    return null;
  }
  // openLiveSerialPort only screens readable.locked; a handle it found open
  // can still have its writer held, and the SDK takes both.
  if (live.readable?.locked || live.writable?.locked) {
    toast.error(localize("web.improv.port_busy"));
    return null;
  }
  if (weOpened) {
    try {
      await live.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch {
      /* Recoverable: the chip is most likely booting fine already. */
    }
  }
  return { port: live, weOpened };
}

async function runImprov(
  cachedPort: SerialPort,
  localize: LocalizeFunc,
  options: ImprovOptions
): Promise<ImprovResult> {
  const acquired = await acquirePort(cachedPort, localize);
  if (!acquired) return NO_IMPROV;
  const { port, weOpened } = acquired;
  if (port !== cachedPort) options.onPortReplaced?.(port);

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
