/**
 * Flashing a Realtek AmebaD (RTL8720D) over Web Serial through the ROM's
 * UART download mode, the way ltchiptool does it: link to the ROM, load
 * Realtek's flash loader into RAM, then erase, write and checksum the first
 * OTA slot through it, and clear the second slot's signature so the
 * bootloader starts what was written. Everything runs at 115200 on the one
 * open: a reopen resets a board whose RTS reaches its reset, which would
 * drop the loader. Loaded on demand by the install flow; nothing here
 * touches the DOM.
 */
import { bytesEqual } from "../../util/bytes.js";
import { formatAddress, tenthLogger } from "../../util/flash-log.js";
import { resetIntoFirmware } from "../../util/serial-control-lines.js";
import { sleep } from "../../util/sleep.js";
import { settledWithin } from "../../util/with-deadline.js";
import type { LibreTinyFlashHooks } from "../libretiny-flash.js";
import type { AmbdImage } from "./ambd-image.js";
import {
  AMBD_FLASH_ADDRESS,
  AMBD_LOADER_ADDRESS,
  AMBD_SECTOR_SIZE,
  AmbdLink,
  checksum32,
} from "./ambd-link.js";
import { loadAmbdLoader } from "./ambd-loader.js";

export { AmbdLoaderError } from "./ambd-loader.js";

const AMBD_BAUD_RATE = 115200;
/** How long the automatic DTR/RTS reset gets to produce a linked ROM. */
const AUTO_LINK_MS = 2000;
/**
 * The automatic reset is tried this many times before the strap guide: on
 * macOS a CH340's first session after a replug does not reach the wire, so
 * the first pulse is often lost.
 */
const AUTO_RESET_ATTEMPTS = 3;
/** The strap guide keeps polling this long before giving up. */
const STRAP_WAIT_MS = 5 * 60 * 1000;
const RESET_HOLD_MS = 100;
/** The ROM is up this long after the reset; the strap is released only then. */
const ROM_SETTLE_MS = 400;
const STRAP_RELEASE_MS = 200;
/** The loader prints its banner and starts NAKing within this. */
const LOADER_START_MS = 300;
/** The loader finishes the last sector this long after the final ACK. */
const WRITE_SETTLE_MS = 150;
/** How long the reboot and the close after a flash each get. */
const TEARDOWN_MS = 2000;

/** ``onWaiting``: the automatic reset produced nothing; the user has to strap the board. */
export type AmbdFlashHooks = LibreTinyFlashHooks;

/** No ROM answered while the user had the chance to enter download mode. */
export class AmbdLinkError extends Error {
  constructor(message = "The chip did not enter download mode") {
    super(message);
    this.name = "AmbdLinkError";
  }
}

export class AmbdVerifyError extends Error {
  constructor(address: number) {
    super(`Flash contents at 0x${address.toString(16)} do not match the image`);
    this.name = "AmbdVerifyError";
  }
}

/**
 * The BW16 kit's USB port drives an ESP-style auto-download circuit: the
 * reset is pulled while RTS is asserted and DTR released, the strap (BURN,
 * LOG_TX low) while DTR is asserted and RTS released, and nothing while both
 * are. So: hold the reset, swap the lines to release it with the strap held
 * (the ROM samples it there), then let go. Held, the strap also holds the
 * chip's TX line low, so it is released before the ROM is probed. False
 * when the adapter has no control lines to drive.
 */
async function autoReset(port: SerialPort): Promise<boolean> {
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await sleep(RESET_HOLD_MS);
    await port.setSignals({ dataTerminalReady: true, requestToSend: false });
    await sleep(ROM_SETTLE_MS);
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(STRAP_RELEASE_MS);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe for the ROM (or a loader a previous run left) until one answers or
 * ``timeoutMs`` passes: the word at the loader's address, or null.
 */
async function linkRom(link: AmbdLink, timeoutMs: number): Promise<Uint8Array | null> {
  const deadline = Date.now() + timeoutMs;
  await link.abortTransfer();
  do {
    const word = await link.readWord(AMBD_LOADER_ADDRESS);
    if (word) return word;
  } while (Date.now() < deadline);
  return null;
}

/** Reset into download mode over DTR/RTS, retrying; the probe's word once the ROM answers. */
async function autoLink(
  port: SerialPort,
  link: AmbdLink,
  log: (line: string) => void
): Promise<Uint8Array | null> {
  for (let attempt = 1; attempt <= AUTO_RESET_ATTEMPTS; attempt++) {
    log(
      attempt === 1
        ? "Resetting the board into download mode over DTR/RTS"
        : `No answer from the ROM; resetting again (attempt ${attempt} of ${AUTO_RESET_ATTEMPTS})`
    );
    const driven = await autoReset(port);
    const word = await linkRom(link, AUTO_LINK_MS);
    if (word) return word;
    if (!driven) return null;
  }
  return null;
}

/** The flash size the JEDEC id names, or null for an id outside the usual range. */
function flashSizeOf(id: Uint8Array): number | null {
  const log2 = id[2];
  return log2 >= 0x11 && log2 <= 0x19 ? 2 ** log2 : null;
}

async function writeRun(
  link: AmbdLink,
  address: number,
  data: Uint8Array,
  onBytes: (sent: number) => void,
  log: (line: string) => void
): Promise<void> {
  const first = address - (address % AMBD_SECTOR_SIZE);
  const sectors = Math.ceil((address - first + data.length) / AMBD_SECTOR_SIZE);
  log(`Erasing ${sectors} sectors at ${formatAddress(first)}`);
  await link.erase(first, sectors);
  log(`Writing ${formatAddress(address)} (${data.length} bytes)`);
  const tenth = tenthLogger(log, `Writing ${formatAddress(address)}`);
  await link.memoryWrite(AMBD_FLASH_ADDRESS | address, data, {
    onBlock: (sent) => {
      onBytes(sent);
      tenth(Math.floor((sent / data.length) * 100));
    },
  });
  await sleep(WRITE_SETTLE_MS);
  const expected = checksum32(data);
  const actual = await link.checksum(address, data.length);
  if (expected !== actual) throw new AmbdVerifyError(address);
  log(`Verified ${formatAddress(address)} (checksum matches)`);
}

/**
 * Flash ``image`` onto the chip behind ``port`` (opened here at 115200 if
 * needed, closed after). The loader is fetched first, so a download that
 * fails costs nothing on the board. The automatic reset is tried next;
 * failing that the ROM is polled until the user straps the board or
 * ``signal`` aborts. Resolves true once the board was rebooted into the
 * firmware, false when the adapter has no control lines to do that and the
 * user must reset it.
 */
export async function flashAmbd(
  port: SerialPort,
  { image, ota2Offset }: AmbdImage,
  hooks: AmbdFlashHooks
): Promise<boolean> {
  const loader = await loadAmbdLoader();
  if (!port.readable) await port.open({ baudRate: AMBD_BAUD_RATE });
  const log = hooks.onLog ?? (() => {});
  let link: AmbdLink | undefined;
  let failure: unknown;
  let rebooted = false;
  try {
    link = new AmbdLink(port, hooks.signal);
    let word = await autoLink(port, link, log);
    if (!word) {
      log(
        "No answer from the ROM; waiting for download mode (LOG_TX to GND, then reset)"
      );
      hooks.onWaiting?.();
      word = await linkRom(link, STRAP_WAIT_MS);
      if (!word) throw new AmbdLinkError();
    }
    hooks.onLinked?.();
    // The word at the loader's address is the loader's own first word once it runs.
    if (bytesEqual(word, loader.subarray(0, 4))) {
      log("The flash loader is already running");
    } else {
      log(`Loading the flash loader (${loader.length} bytes) into RAM`);
      await link.memoryWrite(AMBD_LOADER_ADDRESS, loader);
      await sleep(LOADER_START_MS);
    }
    const id = await link.flashId();
    const size = flashSizeOf(id);
    log(
      `Linked to the flash loader (flash id ${Array.from(id, (b) => b.toString(16).padStart(2, "0")).join(" ")}${
        size ? `, ${size / 2 ** 20} MiB` : ""
      }); ${image.runs.length} runs to write`
    );
    if (size && image.runs.some((r) => r.address + r.data.length > size)) {
      throw new Error("The image does not fit the chip's flash");
    }
    let done = 0;
    for (const run of image.runs) {
      await writeRun(
        link,
        run.address,
        run.data,
        (sent) => {
          hooks.onProgress(
            Math.min(99, Math.floor(((done + sent) / image.totalBytes) * 100))
          );
        },
        log
      );
      done += run.data.length;
    }
    // The bootloader runs the second slot whenever its signature is valid:
    // with the first slot written and verified, clear that signature's
    // sector so the fresh image is what boots (the order LibreTiny's own
    // OTA uses, so a reset in between leaves a bootable slot).
    log(`Clearing the second slot's signature at ${formatAddress(ota2Offset)}`);
    await link.erase(ota2Offset, 1);
    hooks.onProgress(100);
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    // A teardown failure must not replace the flash error nor skip the rest.
    await link?.close(failure).catch(() => {});
    // An RTS pulse with the strap released boots the firmware where the lines reach the board.
    rebooted = await resetIntoFirmware(port, RESET_HOLD_MS, TEARDOWN_MS);
    if (failure === undefined) {
      log(
        rebooted
          ? "Rebooting into the firmware"
          : "No control lines to reboot the board; reset it by hand"
      );
    }
    await settledWithin(port.close(), TEARDOWN_MS);
  }
  return rebooted;
}
