/**
 * Web Serial helpers shared by every platform: availability and the port
 * picker. Re-enumeration lives in ``serial-reacquire.ts`` and the esptool
 * engine in ``src/platforms/esp/esptool.ts``.
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
 * Anything else out of ``connectToPort`` is a real connect failure and
 * must be surfaced, not treated as a cancel (#1414).
 */
export function isPortPickerCancel(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}

/**
 * The user picked a port the caller can't use: the picker's filters can only
 * narrow by USB ids, not exclude one (a Raspberry Pi debug probe shares the
 * Pico's vendor id), so ``accept`` turns the rest away after the pick.
 */
export class PortNotAcceptedError extends Error {
  constructor(readonly port: SerialPort) {
    super("The selected port is not one this flow can use");
    this.name = "PortNotAcceptedError";
  }
}

/**
 * Prompt for a Web Serial port without opening it. Returns ``null`` if the
 * user dismissed the picker; throws on a real requestPort failure. Callers
 * that only need the USB identity can decide before ever opening (no DTR/RTS
 * pulse on a port that won't be used). When ``accept`` rejects the picked
 * port, this throws ``PortNotAcceptedError`` before the port is opened.
 */
export async function requestSerialPort(
  options?: SerialPortRequestOptions,
  accept?: (port: SerialPort) => boolean
): Promise<SerialPort | null> {
  let port: SerialPort;
  try {
    port = await navigator.serial.requestPort(options);
  } catch (err) {
    if (isPortPickerCancel(err)) {
      return null; // User dismissed the port picker.
    }
    throw err; // A real requestPort failure — let the caller surface it.
  }
  if (accept && !accept(port)) throw new PortNotAcceptedError(port);
  return port;
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
