/**
 * Getting the esptool engine into a click, and detecting the board with it.
 * The picker must run inside the click's user activation, so a caller never
 * waits for the chunk before picking: the fetch starts in the same tick and
 * is awaited once the port is chosen.
 */
import { requestSerialPort } from "../../util/web-serial.js";
import { type DeviceManifest, EngineLoadError } from "./esp-usb.js";
import { type Esptool, loadEsptool } from "./esptool-loader.js";
import type { DetectedChip } from "./esptool.js";

/** Warm the engine chunk on a surface about to flash; a miss only costs the fetch later. */
export function preloadEsptool(): void {
  // Logged, not swallowed: some browsers keep a failed module fetch in the
  // module map, so this first failure is the one that explains later ones.
  void loadEsptool().catch((err: unknown) => {
    console.warn("[esptool] Warm-up of the engine chunk failed:", err);
  });
}

function engineLoadError(err: unknown): EngineLoadError {
  // The cause (a 404 after a deploy, a CSP block, offline) only shows here.
  console.error("[esptool] Could not load the engine chunk:", err);
  return new EngineLoadError(err);
}

/** The engine for a port already in hand; ``EngineLoadError`` when its chunk can't be fetched. */
export async function loadEsptoolOrThrow(): Promise<Esptool> {
  try {
    return await loadEsptool();
  } catch (err) {
    throw engineLoadError(err);
  }
}

/**
 * Pick the port in the click while the engine chunk fetches: ``import()``
 * doesn't spend the user activation, and the chunk lands while the picker
 * is open. ``null`` when the picker was dismissed; a failed fetch throws
 * ``EngineLoadError``, a failed pick the browser's own error.
 */
export async function pickPortAndLoadEsptool(): Promise<{
  port: SerialPort;
  esptool: Esptool;
} | null> {
  const engine = loadEsptool();
  engine.catch(() => {}); // reported below once the pick is in, never unhandled
  const port = await requestSerialPort();
  if (!port) return null;
  let esptool: Esptool;
  try {
    esptool = await engine;
  } catch (err) {
    throw engineLoadError(err);
  }
  return { port, esptool };
}

/**
 * Release a connected session without ever throwing: a failed
 * ``transport.disconnect()`` falls back to closing the port directly, as
 * ``connectToPort`` does, so a teardown hiccup neither replaces the caller's
 * result nor leaks an open port into the next ``port.open``.
 */
export async function releaseSerial(
  esptool: Esptool,
  detected: DetectedChip
): Promise<void> {
  try {
    await esptool.disconnect(detected.transport);
  } catch (err) {
    console.warn("[esptool] Disconnect failed, closing the port directly:", err);
    await detected.port.close().catch(() => {});
  }
}

export interface DetectedBoard {
  /** esptool-js's chip description, e.g. "ESP32-S3 (QFN56) (revision v0.2)". */
  chipName: string;
  /** The base MAC, uppercase, when asked for and readable. */
  mac: string | null;
  /** The IDF app descriptor's fields, when the chip runs an IDF app. */
  manifest: DeviceManifest | null;
}

/**
 * Detect the ESP behind *port*, or behind a port picked here when none is
 * given: connect, read the app descriptor (and the MAC when asked), and
 * disconnect. ``null`` when the picker was dismissed; throws
 * ``EngineLoadError``, ``UnsupportedChipError`` or the connect failure.
 */
export async function detectEspBoard(
  port: SerialPort | null,
  options: { readMac?: boolean } = {}
): Promise<DetectedBoard | null> {
  let esptool: Esptool;
  if (port) {
    esptool = await loadEsptoolOrThrow();
  } else {
    const picked = await pickPortAndLoadEsptool();
    if (!picked) return null;
    ({ port, esptool } = picked);
  }
  const detected = await esptool.connectToPort(port);
  try {
    // Best-effort: an unsupported chip family or a transport flap must not
    // sink the detection.
    const mac = options.readMac
      ? await esptool.readMacAddress(detected.loader).catch(() => null)
      : null;
    // readDeviceManifest swallows read and parse failures and returns null.
    const manifest = await esptool.readDeviceManifest(detected.loader);
    return { chipName: detected.chipName, mac, manifest };
  } finally {
    await releaseSerial(esptool, detected);
  }
}
