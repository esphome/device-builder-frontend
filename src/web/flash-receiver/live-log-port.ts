/**
 * Re-acquire the live serial port of a just-flashed, just-reset device so the
 * flasher can stream its boot logs. A native-USB chip (S3/C3/C6) re-enumerates
 * on reset, so the flashing handle is dead; prefer the genuinely new handle
 * (absent before the reset), then other VID/PID matches, then the original
 * handle (UART bridges reopen in place). No re-prompt — every candidate is
 * already authorized. Ported from the device-builder flasher reference.
 */

import { sleep } from "../../util/sleep.js";

/** Same USB device by vendor/product id; both ids must be present. */
function matchesDevice(a: SerialPortInfo, b: SerialPortInfo): boolean {
  return (
    a.usbVendorId !== undefined &&
    a.usbProductId !== undefined &&
    a.usbVendorId === b.usbVendorId &&
    a.usbProductId === b.usbProductId
  );
}

export interface LiveLogPortResult {
  port: SerialPort | null;
  error?: string;
}

/**
 * Find and open the live port for the reset device. Returns the open port, or
 * ``{ port: null, error }`` when none reappeared before ``timeoutMs``.
 * ``shouldStop`` lets the caller abort the wait (user pressed Stop).
 */
export async function openLiveLogPort(
  oldPort: SerialPort,
  before: SerialPort[],
  baud: number,
  timeoutMs: number,
  shouldStop: () => boolean
): Promise<LiveLogPortResult> {
  const want = oldPort.getInfo();
  const beforeSet = new Set(before);
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  for (;;) {
    if (shouldStop()) return { port: null };
    let granted: SerialPort[] = [];
    try {
      granted = await navigator.serial.getPorts();
    } catch (err) {
      lastError = "getPorts failed: " + String(err);
    }
    const matches = granted.filter(
      (p) => p !== oldPort && matchesDevice(p.getInfo(), want)
    );
    const candidates = [
      ...matches.filter((p) => !beforeSet.has(p)), // the re-enumerated handle
      ...matches.filter((p) => beforeSet.has(p)),
      oldPort,
    ];
    for (const p of candidates) {
      if (p.readable) {
        // Open but locked by an existing reader → unusable: streamSerialLines'
        // getReader() would throw "already locked". Skip it and try the next
        // candidate rather than handing back a port that can't be read.
        if (p.readable.locked) {
          lastError = "port stream already locked";
          continue;
        }
        return { port: p }; // already open (reset race left it usable)
      }
      try {
        // 8k buffer (vs Chrome's 255-byte default) so bursty boot logs in a
        // throttled tab don't overrun — matches the logs/improv paths.
        await p.open({ baudRate: baud, bufferSize: 8192 });
        return { port: p };
      } catch (err) {
        lastError = "open failed: " + String(err);
      }
    }
    if (Date.now() >= deadline) return { port: null, error: lastError || undefined };
    await sleep(200);
  }
}
