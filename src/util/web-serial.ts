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
 * inside the window defined by ``SERIAL_ACTIVITY_WINDOW_MS``.
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
 * Open an already-authorized serial port and detect the connected chip.
 *
 * Used for both first-time detect (via ``detectChip`` after the
 * browser picker) and follow-on reconnects (install-flow's resume
 * after compile, the connect-event fast-path that skips the picker).
 *
 * On ``loader.main()`` failure, tries ``transport.disconnect()`` first
 * and falls back to ``port.close()`` so we never leak an open port —
 * a still-open port silently breaks the next ``port.open()`` call.
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
 * Prompt the user to select a serial port and detect the connected chip.
 * Returns chip info + the open connection for subsequent operations.
 */
export async function detectChip(onLog?: LogCallback): Promise<DetectedChip> {
  markSerialActivity();
  const port = await navigator.serial.requestPort();
  return connectToPort(port, onLog);
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
 * Manifest fields read from the ESP-IDF app descriptor
 * (``esp_app_desc_t``) — a 256-byte struct at offset 0x20 of every
 * IDF app image. With ESPHome's default partition layout the app
 * partition starts at 0x10000, so the descriptor lives at 0x10020
 * and is readable from the ROM bootloader over USB-CDC. No custom
 * partition table required.
 *
 * ``board_id`` is sourced from ``esp_app_desc_t.project_name`` (the
 * CMake project name baked in at build time, which ESPHome currently
 * populates from ``esphome.name``). A vendor flashing a factory
 * image just sets ``esphome.name`` to the catalog id; the wizard
 * routes off it via ``api.getBoard(board_id)``.
 */
export interface DeviceManifest {
  /** Board catalog id — ``esp_app_desc_t.project_name``. Routes the wizard. */
  board_id?: string;
  /** ``esp_app_desc_t.version``. */
  version?: string;
}

const APP_DESC_OFFSET = 0x10020;
const APP_DESC_SIZE = 256;
const APP_DESC_MAGIC = 0xabcd5432;

/**
 * Read the ESP-IDF app descriptor and pull out the identifying
 * fields. Returns ``null`` when the magic word doesn't match (not
 * an IDF app, or partition layout drift), when ``project_name`` is
 * empty, or when the flash read fails — callers fall through to
 * chip-name-based board detection in that case.
 */
export async function readDeviceManifest(loader: ESPLoader): Promise<DeviceManifest | null> {
  markSerialActivity();
  try {
    const bytes = await loader.readFlash(APP_DESC_OFFSET, APP_DESC_SIZE);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== APP_DESC_MAGIC) return null;
    // esp_app_desc_t layout: 16 B header (magic + secure_version +
    // 8 B reserved), then version[32], then project_name[32], …
    const decoder = new TextDecoder("utf-8");
    const readField = (offset: number, length: number): string => {
      const slice = bytes.subarray(offset, offset + length);
      const nul = slice.indexOf(0);
      return decoder.decode(slice.subarray(0, nul === -1 ? slice.length : nul));
    };
    const version = readField(16, 32);
    const project_name = readField(48, 32);
    if (!project_name) return null;
    return { board_id: project_name, version };
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
