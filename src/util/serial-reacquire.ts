/**
 * Native-USB re-enumeration helpers for Web Serial.
 *
 * ESP32-C3 / S3 / C6 (USB-Serial/JTAG) drop off the bus and re-enumerate
 * after a plug-in, reset, or flash. This module owns riding that window
 * out: the activity-window suppression the connect-event toast keys off,
 * device matching, per-round enumeration, and the reacquire / reopen
 * retry loops. Everything here is re-exported from ``web-serial.ts`` so
 * existing import paths keep working.
 */
import { sleep } from "./sleep.js";

/**
 * Suppression window for the ``navigator.serial`` connect-event
 * toast. esptool-js's chip reset (DTR/RTS via ``loader.main``)
 * briefly drops native-USB devices like ESP32-C6 / S3 / C3, and
 * the re-enumeration fires a fresh ``connect`` event for the same
 * port — without this guard the toast in ``app-shell`` would loop
 * every time the wizard runs a serial op.
 *
 * Every entry point in this module stamps ``_lastSerialActivityMs``
 * at the start (and the toast click handler in ``app-shell`` does
 * the same to cover the gap between the user's click and the first
 * internal op). ``isRecentSerialActivity`` answers whether we're
 * inside the window defined by ``SERIAL_ACTIVITY_WINDOW_MS``.
 */
let _lastSerialActivityMs = 0;

// Sized to cover the worst case: a chip reset that drops the USB
// device, plus macOS / Linux re-enumeration delay (~2-3s on macOS),
// plus our internal disconnect → port.close → optional hard_reset
// chain. Bursts of re-enum events extend the window further (see
// the handler in ``app-shell``), so this is just the floor.
export const SERIAL_ACTIVITY_WINDOW_MS = 6000;

export function markSerialActivity(): void {
  _lastSerialActivityMs = Date.now();
}

export function isRecentSerialActivity(
  windowMs: number = SERIAL_ACTIVITY_WINDOW_MS
): boolean {
  return Date.now() - _lastSerialActivityMs < windowMs;
}

// Budget for finding a usable handle after a disconnect / post-reset close:
// covers the native-USB re-enumeration window (SERIAL_ACTIVITY_WINDOW_MS) with
// margin for a slower first enumeration on a brand-new board.
export const SERIAL_REOPEN_TIMEOUT_MS = SERIAL_ACTIVITY_WINDOW_MS + 2000;

// Same USB device by vendor/product id. Requires both ids present so two
// non-USB ports (undefined === undefined) aren't treated as a match.
// VID:PID isn't a unique device id: two identical boards both match and
// getPorts() order picks one; Web Serial exposes no per-device serial to
// disambiguate, and every caller's flow is single-device anyway.
export const matchesDevice = (a: SerialPortInfo, b: SerialPortInfo): boolean =>
  a.usbVendorId !== undefined &&
  a.usbProductId !== undefined &&
  a.usbVendorId === b.usbVendorId &&
  a.usbProductId === b.usbProductId;

/**
 * One enumeration round for a possibly re-enumerating device: the
 * freshly-granted handles matching cachedPort's USB ids (a re-enum on Chrome
 * hands out a new handle), plus whether cachedPort itself is still granted.
 * getPorts() can transiently reject mid-re-enumeration; that round counts as
 * nothing granted and the caller's next round retries.
 */
export async function grantedHandlesFor(
  cachedPort: SerialPort
): Promise<{ fresh: SerialPort[]; cachedGranted: boolean }> {
  const want = cachedPort.getInfo();
  let granted: SerialPort[] = [];
  try {
    granted = await navigator.serial.getPorts();
  } catch {
    /* Transient mid-re-enumeration rejection; see the contract above. */
  }
  return {
    fresh: granted.filter((p) => p !== cachedPort && matchesDevice(p.getInfo(), want)),
    cachedGranted: granted.includes(cachedPort),
  };
}

/**
 * Reacquire a live handle for a just-disconnected authorized port, waiting out
 * the native-USB re-enumeration window. ESP32-C3 / S3 / C6 (USB-Serial/JTAG)
 * drop off the bus and come back seconds later, firing a spurious disconnect
 * on the way; without this the UI holding the port treats the blip as a real
 * unplug (#1410).
 *
 * Prefers a freshly-granted getPorts() handle for the same device, falling
 * back to the cached handle when it is granted and connected again (Firefox
 * and UART bridges keep the same handle usable). Returns the handle without
 * opening it, or null when the device stays gone past timeoutMs (a genuine
 * unplug) or the caller cancels.
 */
export async function reacquirePort(
  cachedPort: SerialPort,
  options: { timeoutMs?: number; cancelled?: () => boolean } = {}
): Promise<SerialPort | null> {
  const { timeoutMs = SERIAL_REOPEN_TIMEOUT_MS, cancelled = () => false } = options;
  const deadline = Date.now() + timeoutMs;
  while (!cancelled()) {
    const { fresh, cachedGranted } = await grantedHandlesFor(cachedPort);
    // Presence in getPorts() means the device is granted and physically
    // present; the connected check filters implementations that also return
    // granted-but-unplugged ports (undefined tolerates ones without it).
    const live = [...fresh, ...(cachedGranted ? [cachedPort] : [])].find(
      (p) => p.connected !== false
    );
    if (live) return live;
    if (Date.now() >= deadline) return null;
    await sleep(200);
  }
  return null;
}

/**
 * Open a live handle for a possibly re-enumerating device, retrying through
 * the re-enumeration window. Returns the OPEN port, or ``null`` past
 * ``timeoutMs`` / on cancel.
 *
 * Presence in ``getPorts()`` isn't enough — a device can be enumerated but
 * not yet openable (Chrome throws ``NetworkError`` in that window) — so the
 * ``open()`` attempt is the real liveness test. Each round prefers a
 * freshly-granted handle (Chrome's re-enumerated port), then the cached
 * handle (Firefox / UART bridges reopen it in place).
 */
export async function openLiveSerialPort(
  cachedPort: SerialPort,
  options: {
    baudRate: number;
    bufferSize?: number;
    timeoutMs?: number;
    cancelled?: () => boolean;
  }
): Promise<SerialPort | null> {
  const {
    baudRate,
    bufferSize,
    timeoutMs = SERIAL_REOPEN_TIMEOUT_MS,
    cancelled = () => false,
  } = options;
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (!cancelled()) {
    const { fresh } = await grantedHandlesFor(cachedPort);
    const candidates = [...fresh, cachedPort];
    for (const p of candidates) {
      if (p.readable) {
        // Open but locked by an existing reader → unusable: the caller's
        // getReader() would throw "already locked". Skip it and try the
        // next candidate (mirrors live-log-port's candidate walk).
        if (p.readable.locked) {
          lastErr = new Error("port stream already locked");
          continue;
        }
        return p; // already open (a reset race left it usable)
      }
      try {
        await p.open(bufferSize ? { baudRate, bufferSize } : { baudRate });
        return p;
      } catch (err) {
        lastErr = err;
        const name = err instanceof DOMException ? err.name : "";
        const message = err instanceof Error ? err.message : "";
        // Already open (a reset race / another candidate) — usable only
        // with an actual unlocked stream: a fatal read error leaves a port
        // open with readable null, and returning that would just throw at
        // getReader(). Re-read readable: the failed open() invalidates the
        // null the loop head narrowed to.
        const readableNow = p.readable as ReadableStream<Uint8Array> | null;
        if (
          name === "InvalidStateError" &&
          /already open/i.test(message) &&
          readableNow &&
          !readableNow.locked
        ) {
          return p;
        }
        // Unusable this round — still re-enumerating (NetworkError), claimed
        // by another app, or a transient driver / security error. Fall
        // through to the next candidate and only give up at the deadline.
      }
    }
    if (Date.now() >= deadline) {
      console.error("[Web Serial] Failed to reopen port:", lastErr);
      return null;
    }
    // Re-check before the inter-round sleep so a teardown that landed
    // mid-round short-circuits instead of napping on it.
    if (cancelled()) return null;
    await sleep(200);
  }
  return null;
}
