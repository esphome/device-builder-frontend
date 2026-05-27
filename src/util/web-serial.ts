/**
 * Web Serial utilities using esptool-js.
 *
 * Handles chip detection and firmware flashing via the browser's
 * Web Serial API. No backend involvement — talks directly to the
 * USB-connected ESP device.
 */
import { ClassicReset, ESPLoader, Transport, UsbJtagSerialReset } from "esptool-js";

/** Espressif's USB Vendor ID — chips with native USB-Serial/JTAG. */
const ESPRESSIF_USB_VID = 0x303a;

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
  windowMs: number = SERIAL_ACTIVITY_WINDOW_MS
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
export async function connectToPort(
  port: SerialPort,
  onLog?: LogCallback
): Promise<DetectedChip> {
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
export async function readDeviceManifest(
  loader: ESPLoader
): Promise<DeviceManifest | null> {
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

/**
 * RTC-WDT register addresses per chip — verified against esptool
 * python's per-target files (esptool/targets/{esp32s2,esp32s3,
 * esp32c2,esp32c3}.py). Both the RTC_CNTL_BASE address AND the
 * register offsets within it vary by chip (e.g. WDTCONFIG0 is at
 * +0x84 on C2, +0x90 on C3, +0x94 on S2, +0x98 on S3), so each
 * entry has to spell out the full absolute address.
 *
 * Watchdog reset is the most reliable way to exit the stub bootloader
 * on these chips. esptool's ``--after watchdog-reset`` uses the same
 * trick precisely because DTR/RTS-based resets are unreliable on
 * native-USB / USB-Serial-JTAG chips and on boards whose auto-reset
 * circuit doesn't have the cross-coupled "cancellation" behaviour the
 * standard ClassicReset sequence assumes (M5Stamp C3 with CH9102F is
 * one such combination — the user-reported repro of this fix).
 *
 * Disabled on ESP32-C6 (causes full system freeze per Espressif docs)
 * and on chips without RTC_WDT (ESP8266, classic ESP32, ESP32-H2 /
 * H4 / E22).
 */
const WDT_RESET_CHIPS: Record<
  string,
  { wdtConfig0: number; wdtConfig1: number; wdtWProtect: number }
> = {
  "ESP32-S2": {
    wdtConfig0: 0x3f408094, // base 0x3F408000 + 0x94
    wdtConfig1: 0x3f408098, // + 0x98
    wdtWProtect: 0x3f4080ac, // + 0xAC
  },
  "ESP32-S3": {
    wdtConfig0: 0x60008098, // base 0x60008000 + 0x98
    wdtConfig1: 0x6000809c, // + 0x9C
    wdtWProtect: 0x600080b0, // + 0xB0
  },
  "ESP32-C2": {
    wdtConfig0: 0x60008084, // + 0x84
    wdtConfig1: 0x60008088, // + 0x88
    wdtWProtect: 0x6000809c, // + 0x9C
  },
  "ESP32-C3": {
    wdtConfig0: 0x60008090, // + 0x90
    wdtConfig1: 0x60008094, // + 0x94
    wdtWProtect: 0x600080a8, // + 0xA8
  },
};

/** Magic key that unlocks the RTC WDT write-protect register. */
const RTC_CNTL_WDT_WKEY = 0x50d83aa1;

/**
 * Trigger a full chip reset via the RTC watchdog. The chip's stub
 * bootloader processes the writeReg commands, the WDT fires shortly
 * after, and the chip resets all the way through ROM bootloader to
 * the user firmware. Works even when DTR/RTS-based reset doesn't
 * reach the chip (CH9102F / native USB-Serial-JTAG / boards with
 * non-cross-coupled auto-reset circuits).
 *
 * Returns ``false`` for chip types where this isn't safe (ESP32-C6
 * freezes; classic ESP32 / ESP8266 don't have the WDT at all).
 */
async function watchdogReset(loader: ESPLoader, transport: Transport): Promise<boolean> {
  const regs = loader.chip?.CHIP_NAME
    ? WDT_RESET_CHIPS[loader.chip.CHIP_NAME]
    : undefined;
  if (!regs) return false;
  /* Release the boot-strap pin (IO9 on C3 / IO0 on others) before
     the WDT fires so the chip boots from flash on the new reset, not
     back into download mode. The DTR line is wired to the strap pin
     via the auto-reset circuit on most dev boards. */
  try {
    await transport.setDTR(false);
    await transport.setRTS(false);
  } catch {
    /* If setSignals fails the chip might still WDT-reset OK; don't
       abort the reset path. */
  }
  /* Exact sequence + magic value from esptool python's
     ``watchdog_reset()`` (esptool/targets/esp32c3.py and siblings).
     Order: unlock → set timeout → enable+arm → re-lock. The
     ``(1<<31) | (5<<28) | (1<<8) | 2`` config0 bit pattern is what
     esptool ships — exact bit semantics aren't documented per-chip;
     trust the authoritative source. */
  try {
    await loader.writeReg(regs.wdtWProtect, RTC_CNTL_WDT_WKEY);
    await loader.writeReg(regs.wdtConfig1, 2000);
    await loader.writeReg(regs.wdtConfig0, (1 << 31) | (5 << 28) | (1 << 8) | 2);
    await loader.writeReg(regs.wdtWProtect, 0);
  } catch {
    /* A writeReg may race the actual reset firing — the chip is
       supposed to reset within ~14ms of the timeout write. If the
       last writeReg throws because the chip is mid-reset, the WDT
       has already done its job. */
  }
  /* WDT timeout ≈ 2000 ticks of the slow clock (~14ms on the
     150kHz default). Wait for the chip to reset + reach ROM
     bootloader before we close the port — closing mid-reset can
     leave the kernel-side handle in a weird state on some OSes. */
  await new Promise((resolve) => setTimeout(resolve, 200));
  return true;
}

/**
 * Pick a reset strategy based on the chip and how it's connected.
 *
 * esptool-js's ``loader.after("hard_reset")`` resolves to its
 * ``HardReset`` class which only calls ``setRTS(false)`` — that does
 * not pulse DTR / EN and leaves the chip running the stub bootloader
 * after ``writeFlash``, so the just-flashed firmware never boots and
 * the post-install logs view stays empty forever.
 *
 * - ESP32-S2 / S3 / C2 / C3: trigger an RTC-watchdog reset (the same
 *   trick esptool's ``--after watchdog-reset`` uses). Most reliable
 *   on these chips — works through external UART bridges (CH9102F,
 *   CP210x, etc.) and the chip's own USB-Serial-JTAG alike, and
 *   doesn't depend on the board's auto-reset circuit having the
 *   "cancellation" behaviour the DTR/RTS sequence implicitly assumes.
 * - Native USB-Serial/JTAG (VID 0x303A) for chips not in the WDT
 *   list (mostly fall-through; safety net): esptool-js's
 *   ``UsbJtagSerialReset``.
 * - Everything else (classic ESP32 / ESP8266 via CP210x / CH340 /
 *   FTDI / etc. bridges): the standard DTR/RTS pulse esptool's
 *   ``--after hard-reset`` uses (``ClassicReset``).
 */
async function hardResetChip(
  loader: ESPLoader,
  transport: Transport,
  port: SerialPort
): Promise<void> {
  if (await watchdogReset(loader, transport)) return;
  const vendorId = port.getInfo().usbVendorId;
  if (vendorId === ESPRESSIF_USB_VID) {
    await new UsbJtagSerialReset(transport).reset();
  } else {
    await new ClassicReset(transport, 50).reset();
  }
}

/** Hard-reset the device and disconnect. */
export async function resetAndDisconnect(
  loader: ESPLoader,
  transport: Transport,
  port: SerialPort
): Promise<void> {
  markSerialActivity();
  try {
    await hardResetChip(loader, transport, port);
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
