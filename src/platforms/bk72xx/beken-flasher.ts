/**
 * Flashing a Beken BK72xx over Web Serial through the chip's UART
 * downloader, the protocol bk7231tools speaks and ltchiptool drives:
 * LinkCheck to catch the downloader, the bootloader's CRC to tell the chip
 * and its protocol, then each run sector by sector (erase, write, CRC), and
 * a reboot. Loaded on demand by the install flow; nothing here touches the
 * DOM.
 */
import { formatAddress, tenthLogger } from "../../util/flash-log.js";
import { sleep } from "../../util/sleep.js";
import { settledWithin } from "../../util/with-deadline.js";
import type { LibreTinyFlashHooks } from "../libretiny-flash.js";
import type { LibreTinyImage } from "../libretiny-uf2.js";
import { type BekenChip, familyOf } from "./beken-chips.js";
import {
  BEKEN_BAUD_RATE,
  BekenLink,
  releaseLines,
  resetOverLines,
} from "./beken-link.js";
import { reboot } from "./beken-packets.js";
import { type BekenChipInfo, BekenSession } from "./beken-session.js";

export { BekenResponseError } from "./beken-link.js";
export { BekenUnknownFlashError } from "./beken-session.js";

/** How long each try gets to produce a linked downloader. */
const AUTO_LINK_MS = 2000;
/**
 * The reset over the lines is tried this many times before the guide: on
 * macOS a CH340's first session after a replug does not reach the wire, so
 * the first pulse is often lost.
 */
const AUTO_RESET_ATTEMPTS = 3;
/** The guide keeps polling this long before giving up. */
const RESET_WAIT_MS = 5 * 60 * 1000;
/** How long the close after a flash gets. */
const TEARDOWN_MS = 2000;
/**
 * How long the reboot is given to leave before the port closes. A write
 * resolves once the browser has the bytes, and a bridge without
 * backpressure loses what is still in flight when the port closes.
 */
const REBOOT_DRAIN_MS = 100;
/** ``onWaiting``: nothing answered; the user has to reset the chip while this keeps polling. */
export type BekenFlashHooks = LibreTinyFlashHooks;

/** No downloader answered while the user had the chance to reset the chip. */
export class BekenLinkError extends Error {
  constructor() {
    super("The chip did not enter download mode");
    this.name = "BekenLinkError";
  }
}

/** The image was built for another chip than the one that answered. */
export class BekenChipMismatchError extends Error {
  constructor(
    readonly built: string,
    readonly found: BekenChip
  ) {
    super(`The firmware was built for a ${built}, the chip is a ${found}`);
    this.name = "BekenChipMismatchError";
  }
}

/** Catch the downloader: as it is, after a reset over the lines, then with the user's help. */
async function enterDownloadMode(
  port: SerialPort,
  link: BekenLink,
  hooks: BekenFlashHooks,
  log: (line: string) => void
): Promise<void> {
  // Chromium asserts both lines on open, which holds a chip whose CEN is on
  // RTS in reset.
  const lines = await releaseLines(port);
  log("Looking for the chip's downloader");
  if (await link.link(AUTO_LINK_MS)) return;
  for (let attempt = 1; lines && attempt <= AUTO_RESET_ATTEMPTS; attempt++) {
    log(
      attempt === 1
        ? "No answer; resetting the chip over DTR/RTS"
        : `No answer; resetting again (attempt ${attempt} of ${AUTO_RESET_ATTEMPTS})`
    );
    if (!(await resetOverLines(port))) break;
    if (await link.link(AUTO_LINK_MS)) return;
  }
  log("No answer; waiting for the chip to be reset (CEN to GND, or power it again)");
  hooks.onWaiting?.();
  if (!(await link.link(RESET_WAIT_MS))) throw new BekenLinkError();
}

const describeChip = (info: BekenChipInfo): string =>
  [
    info.chip ?? "unknown chip",
    info.bootloader ? `bootloader ${info.bootloader.name}` : "unknown bootloader",
    info.bootVersion && `version ${info.bootVersion}`,
    info.flashId && `flash ${info.flashId}`,
    `${info.flashSize / 0x100000} MiB`,
  ]
    .filter(Boolean)
    .join(", ");

/**
 * Flash ``image`` onto the chip behind ``port`` (opened here at 115200 if
 * needed, closed after). A chip that runs LibreTiny reboots into its
 * downloader by itself; otherwise a reset over the adapter's lines is
 * tried, and failing that the downloader is polled until the user resets
 * the chip or ``signal`` aborts. The chip boots the firmware at the end.
 */
export async function flashBeken(
  port: SerialPort,
  image: LibreTinyImage,
  hooks: BekenFlashHooks
): Promise<void> {
  if (!port.readable) await port.open({ baudRate: BEKEN_BAUD_RATE });
  const log = hooks.onLog ?? (() => {});
  let link: BekenLink | undefined;
  let failure: unknown;
  try {
    link = new BekenLink(port, hooks.signal);
    await enterDownloadMode(port, link, hooks, log);
    hooks.onLinked?.();
    const session = new BekenSession(link, log);
    const info = await session.detect();
    log(`Linked: ${describeChip(info)}; ${image.runs.length} runs to write`);
    const family = familyOf(image.familyId);
    // Before anything is erased. A chip that could not be told is let
    // through: only its bootloader is unknown, not what the user built for.
    if (family && info.chip && !family.chips.includes(info.chip)) {
      throw new BekenChipMismatchError(family.name, info.chip);
    }
    session.check(image.runs);
    let done = 0;
    for (const run of image.runs) {
      log(`Writing ${formatAddress(run.address)} (${run.data.length} bytes)`);
      const tenth = tenthLogger(log, `Writing ${formatAddress(run.address)}`);
      await session.program(run.address, run.data, (written) => {
        hooks.onProgress(
          Math.min(99, Math.floor(((done + written) / image.totalBytes) * 100))
        );
        tenth(Math.floor((written / run.data.length) * 100));
      });
      // Said of what was written alone: a sector that is all FF is erased
      // and not read back.
      log(`Wrote ${formatAddress(run.address)} (CRC-32 of every sector written matches)`);
      done += run.data.length;
    }
    // No response comes back; the chip boots the firmware.
    await link.command(reboot());
    await sleep(REBOOT_DRAIN_MS);
    log("Rebooting into the firmware");
    hooks.onProgress(100);
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    // A teardown failure must not replace the flash error nor skip the rest.
    await link?.close(failure).catch(() => {});
    await settledWithin(port.close(), TEARDOWN_MS);
  }
}
