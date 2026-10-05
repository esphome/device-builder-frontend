/**
 * Flashing a Realtek AmebaZ (RTL8710B) over Web Serial through the ROM's
 * UART download mode, the way ltchiptool does it: link at 1.5 Mbaud, write
 * at 115200, read the system data to find the OTA slot the bootloader runs
 * next, write that slot's image, then boot it from RAM. Loaded on demand by
 * the install flow; nothing here touches the DOM.
 */
import { formatAddress, tenthLogger } from "../../util/flash-log.js";
import { sleep } from "../../util/sleep.js";
import { settledWithin, withDeadline } from "../../util/with-deadline.js";
import type { LibreTinyFlashHooks } from "../libretiny-flash.js";
import type { LibreTinyImage } from "../libretiny-uf2.js";
import type { AmbzImage } from "./ambz-image.js";
import {
  AMBZ_FLASH_ADDRESS,
  AMBZ_RAM_ADDRESS,
  AMBZ_ROM_BAUD,
  AmbzLink,
} from "./ambz-link.js";
import { UF2_FAMILY_AMBZ } from "./ambz2-image.js";

/** The log UART's speed, where a running LibreTiny listens for the reboot magic. */
const DIAG_BAUD = 115200;
/**
 * What the reads and writes run at once linked. ltchiptool defaults to
 * 460800; cheap adapters drop the ROM's ACKs on writes that fast, so this
 * stays at the log speed.
 */
const WRITE_BAUD = 115200;
/** LibreTiny reboots into download mode on 55 AA and its family id, big endian. */
const DOWNLOAD_MAGIC = new Uint8Array([
  0x55,
  0xaa,
  UF2_FAMILY_AMBZ >>> 24,
  (UF2_FAMILY_AMBZ >> 16) & 0xff,
  (UF2_FAMILY_AMBZ >> 8) & 0xff,
  UF2_FAMILY_AMBZ & 0xff,
]);
const MAGIC_SETTLE_MS = 500;
const AUTO_LINK_MS = 2000;
const STRAP_WAIT_MS = 5 * 60 * 1000;
const RESET_HOLD_MS = 100;
const LINES_MS = 1000;
const REOPEN_MS = 3000;
const TEARDOWN_MS = 2000;
const SYSTEM_OFFSET = 0x9000;
/**
 * The boot table ltchiptool writes to RAM to start the firmware: the entry
 * point (the flash bootloader at 0x5405) followed by the ROM's own vectors.
 */
const RAM_BOOT_TABLE = [
  0x00005405, 0x1000219b, 0x100021ef, 0x100020f5, 0x100021ef, 0x08000541,
];
/** The gaps in the system data, which ltchiptool rewrites as erased flash. */
const SYSTEM_GAPS: readonly [number, number][] = [
  [0x09, 0x10],
  [0x18, 0x20],
  [0x2a, 0x30],
  [0x34, 0x40],
  [0x58, 0xfe0],
  [0xfe4, 0xff0],
];

export type AmbzFlashHooks = LibreTinyFlashHooks;

/** No ROM answered while the user had the chance to enter download mode. */
export class AmbzLinkError extends Error {
  constructor(message = "The chip did not enter download mode") {
    super(message);
    this.name = "AmbzLinkError";
  }
}

/** Which slot to write, and the system data to write first when it must change. */
export function pickSlot(
  system: Uint8Array,
  ota2Offset: number
): { slot: 1 | 2; rewrite: Uint8Array | null } {
  const view = new DataView(system.buffer, system.byteOffset, system.byteLength);
  const ota2Address = view.getUint32(0, true);
  const ota2Switch = view.getUint32(4, true);
  if ((ota2Address & 0xffffff) === ota2Offset) {
    const zeros = 32 - ota2Switch.toString(2).replace(/0/g, "").length;
    return { slot: zeros % 2 === 0 ? 1 : 2, rewrite: null };
  }
  // The bootloader would look for the second image elsewhere: point it at
  // this layout's, and start over from the first slot.
  const rewrite = system.slice(0, 0x1000);
  const out = new DataView(rewrite.buffer);
  out.setUint32(0, (AMBZ_FLASH_ADDRESS | ota2Offset) >>> 0, true);
  out.setUint32(4, 0xffffffff, true);
  for (const [from, to] of SYSTEM_GAPS) rewrite.fill(0xff, from, to);
  return { slot: 1, rewrite };
}

async function setLines(port: SerialPort, signals: SerialOutputSignals): Promise<void> {
  try {
    await withDeadline(
      port.setSignals(signals),
      LINES_MS,
      () => new Error("Setting the control lines timed out")
    );
  } catch {
    // An adapter without control lines: the strap guide covers it.
  }
}

/** Opens and closes the port at each speed the ROM moves between. */
class Session {
  link: AmbzLink | null = null;

  constructor(
    private readonly port: SerialPort,
    private readonly signal?: AbortSignal
  ) {}

  async open(baud: number): Promise<AmbzLink> {
    await this.close();
    await withDeadline(
      this.port.open({ baudRate: baud }),
      REOPEN_MS,
      () => new Error("Reopening the port timed out")
    );
    this.link = new AmbzLink(this.port, this.signal);
    return this.link;
  }

  async close(failure?: unknown): Promise<void> {
    const link = this.link;
    this.link = null;
    await link?.close(failure).catch(() => {});
    if (this.port.readable) await settledWithin(this.port.close(), TEARDOWN_MS);
  }

  /** Move the ROM to ``baud``: ask at the current speed, then follow it. */
  async moveTo(baud: number): Promise<AmbzLink> {
    await this.link!.requestBaud(baud);
    const link = await this.open(baud);
    await link.loudHandshake();
    return link;
  }

  /** After a flash write the ROM is back at 1.5 Mbaud; take it up again. */
  async resume(): Promise<AmbzLink> {
    await this.open(AMBZ_ROM_BAUD);
    const link = await this.moveTo(WRITE_BAUD);
    // Still in download mode: ltchiptool checks the handshake once more here.
    await link.loudHandshake();
    return link;
  }
}

/** The reboot magic at the log speed, then listen at the ROM's; true once linked. */
async function enterDownloadMode(
  session: Session,
  port: SerialPort,
  hooks: AmbzFlashHooks,
  log: (line: string) => void
): Promise<boolean> {
  log("Asking a running LibreTiny firmware to reboot into download mode");
  const diag = await session.open(DIAG_BAUD);
  await diag.write(DOWNLOAD_MAGIC);
  await sleep(MAGIC_SETTLE_MS);
  let link = await session.open(AMBZ_ROM_BAUD);
  if (await link.link(AUTO_LINK_MS)) return true;
  log("No answer from the ROM; resetting the board over RTS");
  await setLines(port, { dataTerminalReady: false, requestToSend: true });
  await sleep(RESET_HOLD_MS);
  await setLines(port, { requestToSend: false });
  link = session.link!;
  if (await link.link(AUTO_LINK_MS)) return true;
  log("No answer from the ROM; waiting for download mode (TX2 to GND, then reset)");
  hooks.onWaiting?.();
  return link.link(STRAP_WAIT_MS);
}

/**
 * Flash ``image`` onto the chip behind ``port`` (opened and closed here at
 * the speeds the ROM needs). Download mode is asked of a running LibreTiny
 * first, then of the reset line; failing both the ROM is polled until the
 * user straps the board or ``signal`` aborts. Resolves true once the chip
 * was booted into the new firmware.
 */
export async function flashAmbz(
  port: SerialPort,
  image: AmbzImage,
  hooks: AmbzFlashHooks
): Promise<boolean> {
  const log = hooks.onLog ?? (() => {});
  const session = new Session(port, hooks.signal);
  let failure: unknown;
  try {
    if (!(await enterDownloadMode(session, port, hooks, log))) throw new AmbzLinkError();
    hooks.onLinked?.();
    // Read at the link speed: the ROM does not answer FLASH_READ at 115200.
    const system = await session.link!.flashRead(SYSTEM_OFFSET, 1);
    let link = await session.moveTo(WRITE_BAUD);
    const { slot, rewrite } = pickSlot(system, image.ota2Offset);
    if (rewrite) {
      log(
        `Pointing the system data at the second slot (${formatAddress(image.ota2Offset)})`
      );
      await link.memoryWrite(AMBZ_FLASH_ADDRESS | SYSTEM_OFFSET, rewrite);
      link = await session.resume();
    }
    const target: LibreTinyImage = slot === 1 ? image.ota1 : image.ota2;
    log(
      `Linked to the ROM downloader; writing OTA slot ${slot} in ${target.runs.length} runs`
    );
    let done = 0;
    for (const run of target.runs) {
      log(`Writing ${formatAddress(run.address)} (${run.data.length} bytes)`);
      const tenth = tenthLogger(log, `Writing ${formatAddress(run.address)}`);
      await link.memoryWrite(AMBZ_FLASH_ADDRESS | run.address, run.data, (sent) => {
        hooks.onProgress(
          Math.min(99, Math.floor(((done + sent) / target.totalBytes) * 100))
        );
        tenth(Math.floor((sent / run.data.length) * 100));
      });
      done += run.data.length;
      link = await session.resume();
    }
    const table = new Uint8Array(RAM_BOOT_TABLE.length * 4);
    const view = new DataView(table.buffer);
    RAM_BOOT_TABLE.forEach((word, i) => view.setUint32(i * 4, word, true));
    // The chip boots before it can ACK the end of the transfer.
    await link.memoryWrite(AMBZ_RAM_ADDRESS, table, undefined, true);
    log("Booting the firmware");
    hooks.onProgress(100);
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    // A teardown failure must not replace the flash error nor skip the rest.
    await session.close(failure);
  }
  return true;
}
