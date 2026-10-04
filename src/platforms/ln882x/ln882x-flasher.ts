/**
 * Flashing a Lightning LN882H over Web Serial through its UART downloader,
 * the protocol ltchiptool speaks for this family: ``version`` to link, the
 * RAM code loaded into SRAM over YMODEM (the BootROM cannot write flash),
 * then per run ``startaddr`` + ``upgrade`` + YMODEM, and ``reboot``. All of
 * it at 115200: the 1 Mbaud ltchiptool switches to for the write does not
 * hold on common adapters. Loaded on demand by the install flow; nothing
 * here touches the DOM.
 */
import { concat } from "../../util/bytes.js";
import { formatAddress, tenthLogger } from "../../util/flash-log.js";
import {
  releaseControlLines,
  resetIntoFirmware,
} from "../../util/serial-control-lines.js";
import { sleep } from "../../util/sleep.js";
import type { Uf2Range } from "../../util/uf2.js";
import { settledWithin, withDeadline } from "../../util/with-deadline.js";
import { ymodemSend } from "../../util/ymodem.js";
import type { LibreTinyFlashHooks } from "../libretiny-flash.js";
import type { LibreTinyImage } from "../libretiny-uf2.js";
import { LnLink } from "./ln882x-link.js";
import { loadRamcode } from "./ln882x-ramcode.js";

export { Ln882xRamcodeError } from "./ln882x-ramcode.js";

const LN882H_BAUD_RATE = 115200;
const RAM_ADDRESS = 0x20000000;
/** How long each try gets to produce a linked downloader. */
const AUTO_LINK_MS = 2000;
/**
 * The reset over the lines is tried this many times before the guide: on
 * macOS a CH340's first session after a replug does not reach the wire, so
 * the first pulse is often lost.
 */
const AUTO_RESET_ATTEMPTS = 3;
/** The guide keeps polling this long before giving up. */
const STRAP_WAIT_MS = 5 * 60 * 1000;
/** The RAM code takes about two seconds to start, as ltchiptool waits. */
const RAMCODE_START_MS = 2000;
/** Relinking after a transfer; the RAM code answers within a second normally. */
const RELINK_MS = 10000;
const RESET_HOLD_MS = 100;
const ROM_SETTLE_MS = 100;
/** How long the reboot and the close after a flash each get. */
const TEARDOWN_MS = 2000;
/** How long a change of the control lines gets; one can stay pending on an unplugged board. */
const LINES_MS = 2000;

/** ``onWaiting``: nothing answered; the user has to strap and reset the chip. */
export type Ln882xFlashHooks = LibreTinyFlashHooks;

/** No downloader answered while the user had the chance to enter download mode. */
export class Ln882xLinkError extends Error {
  constructor(message = "The chip did not enter download mode") {
    super(message);
    this.name = "Ln882xLinkError";
  }
}

/** The RAM code was sent but did not answer as the RAM code. */
export class Ln882xRamBootError extends Error {
  constructor() {
    super("The RAM code did not start after it was loaded");
    this.name = "Ln882xRamBootError";
  }
}

/** The flash did not say its size, or the image does not fit in it. */
export class Ln882xFlashSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Ln882xFlashSizeError";
  }
}

/** The RAM code refused a run's start address. */
export class Ln882xStartAddrError extends Error {
  constructor(address: number) {
    super(`The chip refused the start address ${formatAddress(address)}`);
    this.name = "Ln882xStartAddrError";
  }
}

/** Change the control lines, giving up after ``LINES_MS``. */
const setLines = (port: SerialPort, signals: SerialOutputSignals): Promise<void> =>
  withDeadline(
    port.setSignals(signals),
    LINES_MS,
    () => new Error("The adapter did not change its control lines")
  );

/** Release both lines, best effort and bounded. */
const releaseLines = (port: SerialPort): Promise<boolean> =>
  settledWithin(releaseControlLines(port), LINES_MS);

/**
 * Reset into the downloader the way an ESP style auto-reset circuit wants
 * it, which also suits a board wired straight to the adapter (RTS on CEN,
 * DTR on BOOT): CEN low with BOOT released, then CEN released with BOOT
 * held low, so the BootROM sees BOOT low as it starts. DTR stays held until
 * the RAM code runs. False when the adapter has no control lines.
 */
async function resetIntoDownload(port: SerialPort): Promise<boolean> {
  try {
    await setLines(port, { dataTerminalReady: false, requestToSend: true });
    await sleep(RESET_HOLD_MS);
    await setLines(port, { dataTerminalReady: true, requestToSend: false });
    await sleep(ROM_SETTLE_MS);
    return true;
  } catch {
    // Not with a line left held, which could keep the chip in reset.
    await releaseLines(port);
    return false;
  }
}

/** Drop the BOOT strap; the BootROM only reads it at reset. */
async function releaseStrap(port: SerialPort): Promise<void> {
  try {
    await setLines(port, { dataTerminalReady: false });
  } catch {
    // No control lines: the user holds BOOT and can let go now.
  }
}

/**
 * Runs that follow on from one another, joined into one transfer, as
 * ltchiptool's collect_data joins them. The RAM code carries the tail of one
 * transfer into the next (bootram_enter_file_mode resets cache_buffer_pos but
 * not cache_tailing_pos), so a build's bootloader, partition table and app,
 * which follow on from one another, have to go as one.
 */
function joinRuns(runs: readonly Uf2Range[]): Uf2Range[] {
  const joined: Uf2Range[] = [];
  for (const run of runs) {
    const last = joined[joined.length - 1];
    if (last && last.address + last.data.length === run.address) {
      last.data = concat(last.data, run.data);
    } else {
      joined.push({ address: run.address, data: run.data });
    }
  }
  return joined;
}

/**
 * Reset over the lines for a reboot the RAM code did not confirm, and say
 * whether it took: an adapter wired to TX, RX and GND alone takes the line
 * changes too, so only a downloader that no longer answers counts.
 */
async function resetConfirmed(port: SerialPort, link: LnLink): Promise<boolean> {
  if (!(await resetIntoFirmware(port, RESET_HOLD_MS, TEARDOWN_MS))) return false;
  return (await link.ping()) === null;
}

/** Catch the downloader: as it is, after a reset over the lines, then with the user's help. */
async function enterDownloadMode(
  port: SerialPort,
  link: LnLink,
  hooks: Ln882xFlashHooks,
  log: (line: string) => void
): Promise<void> {
  // Chromium asserts both lines on open, which holds a chip whose CEN is on
  // RTS in reset.
  await releaseLines(port);
  log("Looking for the chip's downloader");
  if (await link.link(AUTO_LINK_MS)) return;
  for (let attempt = 1; attempt <= AUTO_RESET_ATTEMPTS; attempt++) {
    log(
      attempt === 1
        ? "No answer; resetting the chip into download mode over DTR/RTS"
        : `No answer; resetting again (attempt ${attempt} of ${AUTO_RESET_ATTEMPTS})`
    );
    if (!(await resetIntoDownload(port))) break;
    if (await link.link(AUTO_LINK_MS)) return;
  }
  await releaseLines(port);
  log("No answer; waiting for download mode (BOOT, GPIOA9, to GND, then reset)");
  hooks.onWaiting?.();
  if (!(await link.link(STRAP_WAIT_MS))) throw new Ln882xLinkError();
}

/** Load the RAM code into SRAM and link to it; a chip already running it is left as it is. */
async function bootRamcode(
  link: LnLink,
  ramcode: Uint8Array,
  log: (line: string) => void
): Promise<void> {
  if (link.ramcode) {
    log("The RAM code is already running");
    return;
  }
  log(`Loading the RAM code (${ramcode.length} bytes)`);
  await link.send(
    `download [rambin] [${formatAddress(RAM_ADDRESS)}] [${ramcode.length}]`
  );
  await ymodemSend(link, "ramcode.bin", ramcode);
  await sleep(RAMCODE_START_MS);
  if ((await link.link(RELINK_MS)) !== "ramcode") throw new Ln882xRamBootError();
}

/** The flash size from ``flash_info``: the low byte of the JEDEC id is its log2. */
async function flashSize(link: LnLink): Promise<{ id: string; size: number }> {
  const replies = await link.command("flash_info");
  const match = replies.map((line) => /id:0x([0-9a-f]+)/i.exec(line)).find(Boolean);
  const bits = match ? parseInt(match[1], 16) & 0xff : 0;
  if (!match || bits < 16 || bits > 26) {
    throw new Ln882xFlashSizeError(
      `The chip did not report its flash (${replies.join(" | ") || "no reply"})`
    );
  }
  return { id: match[1].toUpperCase(), size: 1 << bits };
}

async function writeRun(
  link: LnLink,
  address: number,
  data: Uint8Array,
  onBytes: (sent: number) => void,
  log: (line: string) => void
): Promise<void> {
  log(`Writing ${formatAddress(address)} (${data.length} bytes)`);
  const tenth = tenthLogger(log, `Writing ${formatAddress(address)}`);
  const reply = await link.command(`startaddr ${formatAddress(address)}`);
  if (!reply.includes("pppp")) throw new Ln882xStartAddrError(address);
  await link.send("upgrade");
  await ymodemSend(link, "firmware.bin", data, {
    onBlock: (sent) => {
      onBytes(sent);
      tenth(Math.floor((sent / data.length) * 100));
    },
  });
  if ((await link.link(RELINK_MS)) !== "ramcode") {
    throw new Ln882xLinkError("The chip stopped answering after the transfer");
  }
  // The RAM code reads every chunk back after writing it and rewrites one
  // that differs, so a transfer it accepted is in flash.
  log(`Wrote ${formatAddress(address)}`);
}

/**
 * Flash ``image`` onto the chip behind ``port`` (opened here at 115200 if
 * needed, closed after). The RAM code is fetched first; then the chip is
 * looked for as it is, after a reset over the adapter's lines, and failing
 * that the downloader is polled until the user straps BOOT and resets it or
 * ``signal`` aborts. Resolves true once the chip was rebooted into the
 * firmware, false when it has to be reset by hand.
 */
export async function flashLn882x(
  port: SerialPort,
  image: LibreTinyImage,
  hooks: Ln882xFlashHooks
): Promise<boolean> {
  const log = hooks.onLog ?? (() => {});
  // Before the port: a missing RAM code should not cost the user a strap.
  const ramcode = await loadRamcode();
  // A dialog closed during the download must not see its board reset.
  hooks.signal?.throwIfAborted();
  if (!port.readable) await port.open({ baudRate: LN882H_BAUD_RATE });
  let link: LnLink | undefined;
  let failure: unknown;
  let rebooted = false;
  try {
    link = new LnLink(port, hooks.signal);
    await enterDownloadMode(port, link, hooks, log);
    hooks.onLinked?.();
    await bootRamcode(link, ramcode, log);
    await releaseStrap(port);
    const flash = await flashSize(link);
    const runs = joinRuns(image.runs);
    log(
      `Linked to the RAM code (flash ${flash.id}, ${flash.size / 0x100000} MiB); ${runs.length} runs to write`
    );
    const past = runs.find((run) => run.address + run.data.length > flash.size);
    if (past) {
      throw new Ln882xFlashSizeError(
        `The image runs to ${formatAddress(past.address + past.data.length)}, past the end of the flash`
      );
    }
    let done = 0;
    for (const run of runs) {
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
    rebooted =
      (await link.command("reboot")).includes("pppp") ||
      (await resetConfirmed(port, link));
    hooks.onProgress(100);
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    // A teardown failure must not replace the flash error nor skip the rest.
    await link?.close(failure).catch(() => {});
    // Not with BOOT held, which would send the next reset to the ROM again.
    await releaseLines(port);
    if (failure === undefined) {
      log(
        rebooted
          ? "Rebooting into the firmware"
          : "The chip did not confirm the reboot; release BOOT and reset it by hand"
      );
    }
    await settledWithin(port.close(), TEARDOWN_MS);
  }
  return rebooted;
}
