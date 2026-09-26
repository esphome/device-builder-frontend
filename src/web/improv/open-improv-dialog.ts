// Type-only import: pulls in the SDK's HTMLElementTagNameMap augmentation
// (so ``document.createElement`` is typed and ``.port`` is assignable) with no
// runtime cost. The element itself is registered by the dynamic import below,
// which rspack code-splits into its own chunk (it drags in the MWC component
// set, kept out of the entry bundle).
import type {} from "improv-wifi-serial-sdk/dist/serial-provision-dialog";
import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import { isRp2CdcPort } from "../../platforms/rp2/index.js";
import { openFailureMessage } from "../../util/serial-open-error.js";
import { openLiveSerialPort } from "../../util/serial-reacquire.js";
import { sleep } from "../../util/sleep.js";

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
   * Leave DTR and RTS as opened. Needed where the board's CDC only transmits
   * while DTR is asserted (a Pico), so clearing it silences the device and
   * Improv never answers. Unset, a Pico's own port still keeps them (it can
   * reach Improv from the ESP card when its flow switch toast was dismissed);
   * anything else has them cleared, which keeps an auto-reset circuit on a
   * UART-bridge board from holding EN low.
   */
  keepLines?: boolean;
  /**
   * Called when the session had to reopen on a different handle than the one
   * passed in (a native-USB chip re-enumerated after its post-flash reset).
   * The card should adopt it for its other actions; see ``port-replaced``.
   */
  onPortReplaced?: (port: SerialPort) => void;
  /**
   * The device was just reset (post-flash hand-off), so give the reopen the
   * full re-enumeration budget. Off for the manual Configure Wi-Fi button,
   * where nothing is re-enumerating and a dead port should fail fast.
   */
  afterReset?: boolean;
}

/** Reopen budget when no reset preceded the click: fail fast, not in 8 s. */
const MANUAL_OPEN_TIMEOUT_MS = 2000;

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

// Sessions between ``openImprovDialog``'s first await and its dialog closing.
let inFlight = 0;

/**
 * Whether Wi-Fi setup is in progress on any port: from the first await of
 * ``openImprovDialog`` (port acquisition, the lazy SDK import) until its
 * dialog has closed. The SDK owns that dialog, so it is not a wrapper dialog.
 */
export function isImprovInProgress(): boolean {
  return inFlight > 0;
}

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
  // Also guard the handle the session actually runs on: after a
  // ``port-replaced`` adoption the card's next click passes the fresh handle.
  const guarded = [port];
  activePorts.add(port);
  inFlight++;
  try {
    return await runImprov(port, localize, options, (live) => {
      guarded.push(live);
      activePorts.add(live);
    });
  } finally {
    inFlight--;
    for (const p of guarded) activePorts.delete(p);
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
  localize: LocalizeFunc,
  afterReset: boolean,
  keepLines: boolean | undefined
): Promise<{ port: SerialPort; weOpened: boolean } | null> {
  // An open handle is reused only while its device is still attached: a
  // reset that threw out of transport.disconnect() can leave the pre-reset
  // handle open but dead, and that one must go through the reopen loop.
  if (port.readable && port.connected !== false) {
    if (port.readable.locked || port.writable?.locked) {
      toast.error(localize("web.improv.port_busy"));
      return null;
    }
    return { port, weOpened: false };
  }
  if (port.readable) {
    // Open but its device is gone: close it so the reopen loop can actually
    // reopen it if the same handle comes back (UART bridge / same-handle
    // re-enumeration), instead of handing the SDK the errored stream. Mirrors
    // the logs dialog's recovery.
    await port.close().catch(() => {});
  }
  let weOpened = false;
  let failure: unknown = null;
  const live = await openLiveSerialPort(port, {
    baudRate: IMPROV_BAUD_RATE,
    bufferSize: IMPROV_BUFFER_SIZE,
    ...(afterReset ? {} : { timeoutMs: MANUAL_OPEN_TIMEOUT_MS }),
    onOpened: () => {
      weOpened = true;
    },
    // Right after a reset a NetworkError can be the board re-enumerating, so
    // only a manual open reads it as another tab or program holding the port.
    onFailed: afterReset ? undefined : (err) => (failure = err),
  });
  if (!live) {
    // A manual open says why it failed; after a reset keep the restart advice.
    toast.error(
      failure ? openFailureMessage(failure, localize) : localize("web.improv.open_failed")
    );
    return null;
  }
  // openLiveSerialPort only screens readable.locked; a handle it found open
  // can still have its writer held, and the SDK takes both.
  if (live.readable?.locked || live.writable?.locked) {
    toast.error(localize("web.improv.port_busy"));
    return null;
  }
  // Clearing the lines keeps an auto-reset circuit on a UART-bridge board
  // from holding EN low (see ImprovOptions.keepLines for the exception).
  if (weOpened && !(keepLines ?? isRp2CdcPort(live))) {
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
  options: ImprovOptions,
  onReplaced: (port: SerialPort) => void
): Promise<ImprovResult> {
  const acquired = await acquirePort(
    cachedPort,
    localize,
    options.afterReset ?? false,
    options.keepLines
  );
  if (!acquired) return NO_IMPROV;
  const { port, weOpened } = acquired;
  if (port !== cachedPort) {
    onReplaced(port);
    options.onPortReplaced?.(port);
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

  dialogMounted();
  return new Promise<ImprovResult>((resolve) => {
    dialog.addEventListener(
      "closed",
      (ev: Event) => {
        const detail = (ev as CustomEvent<Partial<ImprovResult>>).detail ?? {};
        const result: ImprovResult = {
          improv: Boolean(detail.improv),
          provisioned: Boolean(detail.provisioned),
        };
        dialogClosed();
        // Release the port only if we opened it, and resolve once it is closed
        // (or releasePort gave up at its deadline) so the card's next action
        // normally finds it free (#1839).
        void (weOpened ? releasePort(port) : Promise.resolve()).then(() =>
          resolve(result)
        );
      },
      { once: true }
    );
    document.body.appendChild(dialog);
  });
}

/** How long ``releasePort`` keeps retrying a close the SDK's reader or writer still blocks. */
const RELEASE_TIMEOUT_MS = 1000;

/**
 * Close a port the session opened. The SDK cancels its reader in its own close
 * handler, but that release can land after ours, and a close while either
 * stream is still locked fails; retry briefly. Best-effort: resolves at the
 * deadline even if the close is still pending or failing (the device may be gone).
 */
async function releasePort(port: SerialPort): Promise<void> {
  const deadline = Date.now() + RELEASE_TIMEOUT_MS;
  for (;;) {
    try {
      // A wedged driver can leave close() pending; never hold the caller past the deadline.
      const closed = await Promise.race([
        port.close().then(() => true),
        sleep(Math.max(deadline - Date.now(), 0)).then(() => false),
      ]);
      if (!closed) console.warn("[Improv] Port close still pending; moving on");
      return;
    } catch (err) {
      // The SDK holds a reader and a writer; either one still locked blocks the close.
      const locked = (port.readable?.locked ?? false) || (port.writable?.locked ?? false);
      if (!locked || Date.now() >= deadline) {
        console.warn("[Improv] Could not close the port:", err, { locked });
        return;
      }
      await sleep(50);
    }
  }
}

/** The SDK's RPC timeout: how long after a close its late rejection can still land. */
const LATE_STATE_ERROR_MS = 30_000;
/** The one message the guard swallows: the state request losing to the detection timeout. */
const LATE_STATE_ERROR = "Error fetching current state: TIMEOUT";

/**
 * The SDK's ``initialize`` races its first state request against a detection
 * timeout inside an async promise executor. When the timeout wins (a device
 * that never answers), the dialog shows its error state, but the request's
 * own later rejection has nothing to catch it and surfaces as an unhandled
 * "Error fetching current state: TIMEOUT" (improv-wifi/sdk-serial-js,
 * serial.js). Swallow exactly that while a dialog is up and for an RPC
 * timeout after one closed; anything else, including a device error on the
 * same request, stays loud.
 */
let mountedDialogs = 0;
let swallowUntil = 0;
let listening = false;

function dialogMounted(): void {
  mountedDialogs++;
  if (listening) return;
  listening = true;
  // Capture phase, so this runs before other window listeners (the dev
  // server's error overlay reports every unhandled rejection, handled or not),
  // and stopping propagation keeps the swallowed one from reaching them.
  window.addEventListener(
    "unhandledrejection",
    (ev: PromiseRejectionEvent) => {
      if (mountedDialogs === 0 && Date.now() >= swallowUntil) return;
      const reason = ev.reason as { message?: unknown } | undefined;
      const message =
        typeof reason?.message === "string" ? reason.message : String(ev.reason);
      if (message !== LATE_STATE_ERROR) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    },
    { capture: true }
  );
}

function dialogClosed(): void {
  mountedDialogs--;
  swallowUntil = Date.now() + LATE_STATE_ERROR_MS;
}
