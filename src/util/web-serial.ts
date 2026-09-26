/**
 * Web Serial helpers shared by every platform: availability, the port picker,
 * and the re-enumeration helpers. The esptool engine lives in
 * ``src/platforms/esp/esptool.ts``.
 */
export type LogCallback = (line: string) => void;

/** Why Web Serial can or can't be used here. */
export type WebSerialAvailability = "available" | "insecure-context" | "unsupported";

/**
 * Resolve Web Serial's actual availability, distinguishing the two ways it can
 * be missing. ``available`` keys off the real ``navigator.serial`` API, so it's
 * browser-agnostic: Chrome, Edge, and Firefox 151+ all qualify (no UA-sniffing).
 *
 * The API is only exposed in a secure context (localhost / 127.0.0.1 over http,
 * or https), so on ``0.0.0.0`` or a LAN IP over plain http every browser hides
 * it. Treat "API missing + insecure origin" as a capable browser blocked by the
 * origin (fixable) rather than an unsupported browser.
 */
export function webSerialAvailability(): WebSerialAvailability {
  if ("serial" in navigator) return "available";
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "insecure-context";
  }
  return "unsupported";
}

/** Check if Web Serial is supported in this browser. */
export function isWebSerialSupported(): boolean {
  return webSerialAvailability() === "available";
}

/**
 * True when the user dismissed the browser's port picker —
 * ``requestPort()`` rejects with DOMException ``NotFoundError``.
 * Anything else out of ``detectChip`` is a real connect failure and
 * must be surfaced, not treated as a cancel (#1414).
 */
export function isPortPickerCancel(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}

/**
 * Prompt for a Web Serial port without opening it. Returns ``null`` if the
 * user dismissed the picker; throws on a real requestPort failure. Callers
 * that only need the USB identity can decide before ever opening (no DTR/RTS
 * pulse on a port that won't be used).
 */
export async function requestSerialPort(
  options?: SerialPortRequestOptions
): Promise<SerialPort | null> {
  try {
    return await navigator.serial.requestPort(options);
  } catch (err) {
    if (isPortPickerCancel(err)) {
      return null; // User dismissed the port picker.
    }
    throw err; // A real requestPort failure — let the caller surface it.
  }
}

/**
 * The ``127.0.0.1`` equivalent of a dashboard opened on ``0.0.0.0`` — same
 * port and path. ``0.0.0.0`` is reachable only from the same machine (it
 * resolves to loopback) but is NOT a secure context, so Web Serial is hidden;
 * the loopback URL hits the same backend AND is a secure context, so Web Serial
 * works there. Returns null for any other host (a LAN IP could be a different
 * machine, where 127.0.0.1 wouldn't reach this backend).
 */
export function secureLoopbackUrl(): string | null {
  if (typeof window === "undefined") return null;
  if (window.location.hostname !== "0.0.0.0") return null;
  const url = new URL(window.location.href);
  url.hostname = "127.0.0.1";
  return url.toString();
}

// The re-enumeration helpers live in ``serial-reacquire.ts``; re-exported
// here so long-standing import paths (and their tests) keep working.
export {
  grantedHandlesFor,
  isOwnSerialReenumeration,
  isRecentSerialActivity,
  markSerialActivity,
  matchesDevice,
  openLiveSerialPort,
  portOfSerialConnectEvent,
  reacquirePort,
  SERIAL_ACTIVITY_WINDOW_MS,
  SERIAL_REOPEN_TIMEOUT_MS,
  SerialConnectAnnouncements,
} from "./serial-reacquire.js";
