/**
 * Web Serial utilities using esptool-js.
 *
 * Handles chip detection and firmware flashing via the browser's
 * Web Serial API. No backend involvement — talks directly to the
 * USB-connected ESP device.
 */
import { ESPLoader, Transport } from "esptool-js";

export interface DetectedChip {
  chipName: string;
  port: SerialPort;
  transport: Transport;
  loader: ESPLoader;
}

export interface FlashProgress {
  fileIndex: number;
  written: number;
  total: number;
  percent: number;
}

export type LogCallback = (line: string) => void;

/** Check if Web Serial is supported in this browser. */
export function isWebSerialSupported(): boolean {
  return "serial" in navigator;
}

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
 * inside that ~3-second window.
 */
let _lastSerialActivityMs = 0;

// Sized to cover the worst case: a chip reset that drops the USB
// device, plus macOS / Linux re-enumeration delay (~2-3s on macOS),
// plus our internal disconnect → port.close → optional hard_reset
// chain. Bursts of re-enum events extend the window further (see
// the handler in ``app-shell``), so this is just the floor.
const SERIAL_ACTIVITY_WINDOW_MS = 6000;

export function markSerialActivity(): void {
  _lastSerialActivityMs = Date.now();
}

export function isRecentSerialActivity(
  windowMs: number = SERIAL_ACTIVITY_WINDOW_MS,
): boolean {
  return Date.now() - _lastSerialActivityMs < windowMs;
}

/**
 * Prompt the user to select a serial port and detect the connected chip.
 * Returns chip info + the open connection for subsequent operations.
 */
export async function detectChip(onLog?: LogCallback): Promise<DetectedChip> {
  markSerialActivity();
  const port = await navigator.serial.requestPort();

  const transport = new Transport(port, false);

  const loader = new ESPLoader({
    transport,
    baudrate: 115200,
    terminal: onLog
      ? {
          clean: () => {},
          writeLine: (line: string) => onLog(line),
          write: (text: string) => onLog(text),
        }
      : undefined,
  });

  try {
    const chipName = await loader.main();
    return { chipName, port, transport, loader };
  } catch (error) {
    try {
      await transport.disconnect();
    } catch {
      try {
        await port.close();
      } catch {
        // Best-effort cleanup; rethrow the original detection error below.
      }
    }
    throw error;
  }
}

/**
 * Reconnect to an already-authorized serial port (no browser picker).
 * Use after disconnect + compile to resume the connection for flashing.
 */
export async function connectToPort(port: SerialPort, onLog?: LogCallback): Promise<DetectedChip> {
  markSerialActivity();
  const transport = new Transport(port, false);

  const loader = new ESPLoader({
    transport,
    baudrate: 115200,
    terminal: onLog
      ? {
          clean: () => {},
          writeLine: (line: string) => onLog(line),
          write: (text: string) => onLog(text),
        }
      : undefined,
  });

  const chipName = await loader.main();
  return { chipName, port, transport, loader };
}

/**
 * Detect the chip on an already-authorized port — same as ``detectChip``
 * but without the browser picker. The ``connect`` event on
 * ``navigator.serial`` carries the port via ``event.target``; that port
 * is already permitted for this origin, so we can go straight to
 * ``loader.main()`` without an extra user gesture.
 *
 * Cleans up the transport on failure so we never leak an open port
 * (same shape as ``detectChip``'s error path).
 */
export async function detectChipOnPort(port: SerialPort, onLog?: LogCallback): Promise<DetectedChip> {
  try {
    return await connectToPort(port, onLog);
  } catch (error) {
    try {
      await port.close();
    } catch {
      // Best-effort cleanup; rethrow the original detection error below.
    }
    throw error;
  }
}

/**
 * Read the base MAC address from the chip's eFuse, normalized to the
 * uppercase colon-separated form the backend stores in
 * ``ConfiguredDevice.mac_address``. esptool-js returns lowercase; the
 * device's mDNS broadcast is normalized to uppercase at backend
 * ingest, so callers comparing the two need the cases to match.
 */
export async function readMacAddress(loader: ESPLoader): Promise<string> {
  markSerialActivity();
  const raw = await loader.chip.readMac(loader);
  return raw.toUpperCase();
}

/**
 * Manifest written by the factory at the ``device_info`` flash
 * partition (offset 0xC000, 4 KiB). UTF-8 JSON at the front, 0xFF
 * padding to the end of the partition. Generated by
 * ``tools/apollo-starterkit-factory/build.py``.
 */
export interface DeviceManifest {
  manufacturer?: string;
  product?: string;
  hw_rev?: string;
  /** Board catalog id this product maps to. The factory bakes it in;
   *  the frontend just calls ``api.getBoard(board_id)`` and routes
   *  the wizard accordingly. Lets new products onboard without any
   *  dashboard / backend change — only a manifest edit. */
  board_id?: string;
}

const DEVICE_INFO_OFFSET = 0xc000;
const DEVICE_INFO_SIZE = 4096;

/**
 * Read the factory-written device manifest. Returns ``null`` when no
 * manifest is present (whole partition is 0xFF), when the JSON
 * payload doesn't parse, or when reading the flash fails — callers
 * fall through to chip-name-based board detection in that case.
 */
export async function readDeviceManifest(loader: ESPLoader): Promise<DeviceManifest | null> {
  markSerialActivity();
  try {
    const bytes = await loader.readFlash(DEVICE_INFO_OFFSET, DEVICE_INFO_SIZE);
    // Manifest ends at the first 0xFF byte (factory padding). An
    // empty partition is 4 KiB of 0xFF — end === 0, nothing to parse.
    let end = bytes.length;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0xff) {
        end = i;
        break;
      }
    }
    if (end === 0) return null;
    const text = new TextDecoder("utf-8").decode(bytes.slice(0, end));
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as DeviceManifest;
  } catch {
    return null;
  }
}

/**
 * Flash firmware binary data to a connected ESP device.
 * Assumes detectChip() was already called and the loader is connected.
 */
export async function flashFirmware(
  loader: ESPLoader,
  data: Uint8Array,
  address: number,
  onProgress?: (progress: FlashProgress) => void
): Promise<void> {
  markSerialActivity();
  await loader.writeFlash({
    fileArray: [{ data, address }],
    flashSize: "keep",
    flashMode: "keep",
    flashFreq: "keep",
    eraseAll: false,
    compress: true,
    reportProgress: (fileIndex, written, total) => {
      // Keep the suppression window alive throughout long flashes —
      // a 60-second write would otherwise let the post-flash reset
      // toast leak through despite the operation still being active.
      markSerialActivity();
      onProgress?.({
        fileIndex,
        written,
        total,
        percent: Math.round((written / total) * 100),
      });
    },
  });
}

/** Hard-reset the device and disconnect. */
export async function resetAndDisconnect(
  loader: ESPLoader,
  transport: Transport
): Promise<void> {
  markSerialActivity();
  try {
    await loader.after("hard_reset");
  } finally {
    await transport.disconnect();
    // hard_reset triggers a USB re-enumeration on native-USB chips;
    // re-stamp so the resulting connect event lands inside the window.
    markSerialActivity();
  }
}

/** Disconnect without resetting. */
export async function disconnect(transport: Transport): Promise<void> {
  markSerialActivity();
  await transport.disconnect();
}
