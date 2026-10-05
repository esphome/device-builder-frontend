/**
 * Flashing a Realtek AmebaZ (RTL8710B) over Web Serial through the ROM's
 * UART download mode, the way ltchiptool does it: link at 1.5 Mbaud, write
 * at 115200, read the system data to find the OTA slot the bootloader runs
 * next, then write that slot's image and leave the reset to the user. The
 * board enters download mode by its strap (or an RTS wired to its reset).
 * Loaded on demand by the install flow; nothing here touches the DOM.
 */
import { bytesEqual } from "../../util/bytes.js";
import { formatAddress, tenthLogger } from "../../util/flash-log.js";
import { resetIntoFirmware } from "../../util/serial-control-lines.js";
import { openSerialPort, SerialOpenTimeoutError } from "../../util/serial-open-error.js";
import { settledWithin, withDeadline } from "../../util/with-deadline.js";
import type { LibreTinyFlashHooks } from "../libretiny-flash.js";
import type { AmbzImage } from "./ambz-image.js";
import { AMBZ_FLASH_ADDRESS, AMBZ_ROM_BAUD, AmbzLink } from "./ambz-link.js";

/**
 * What the writes run at. ltchiptool defaults to 460800; cheap adapters lose
 * the ROM's ACKs on writes that fast, so this stays at the log speed.
 */
const WRITE_BAUD = 115200;
const AUTO_LINK_MS = 2000;
const STRAP_WAIT_MS = 5 * 60 * 1000;
const RESET_HOLD_MS = 100;
const LINES_MS = 1000;
const REOPEN_MS = 3000;
const TEARDOWN_MS = 2000;
const SYSTEM_OFFSET = 0x9000;
/** The gaps in the system data, which ltchiptool rewrites as erased flash. */
const SYSTEM_GAPS: readonly [number, number][] = [
  [0x09, 0x10],
  [0x18, 0x20],
  [0x2a, 0x30],
  [0x34, 0x40],
  [0x58, 0xfe0],
  [0xfe4, 0xff0],
];

/** No ROM answered while the user had the chance to enter download mode. */
export class AmbzLinkError extends Error {
  constructor() {
    super("The chip did not enter download mode");
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
    let zeros = 0;
    for (let v = ~ota2Switch >>> 0; v; v &= v - 1) zeros++;
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

/** Opens and closes the port at each speed the ROM moves between. */
class Session {
  private link: AmbzLink | null = null;

  constructor(
    private readonly port: SerialPort,
    private readonly signal?: AbortSignal
  ) {}

  async open(baud: number): Promise<AmbzLink> {
    await this.close();
    const opening = openSerialPort(this.port, { baudRate: baud });
    try {
      await withDeadline(opening, REOPEN_MS, () => new SerialOpenTimeoutError(REOPEN_MS));
    } catch (err) {
      // An open that lands after the deadline would hold the port past this failure.
      opening.then(
        () => settledWithin(this.port.close(), TEARDOWN_MS),
        () => {}
      );
      throw err;
    }
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
    // It prints "close xModem Transfer" at the write speed first.
    await (await this.open(AMBZ_ROM_BAUD)).settle();
    const link = await this.moveTo(WRITE_BAUD);
    // Still in download mode: ltchiptool checks the handshake once more here.
    await link.loudHandshake();
    return link;
  }
}

/** Listen for the ROM, then pulse RTS, then wait for the strap; the link once linked. */
async function enterDownloadMode(
  session: Session,
  port: SerialPort,
  hooks: LibreTinyFlashHooks,
  log: (line: string) => void
): Promise<AmbzLink | null> {
  log("Looking for the ROM downloader");
  const link = await session.open(AMBZ_ROM_BAUD);
  if (await link.link(AUTO_LINK_MS)) return link;
  if (await resetIntoFirmware(port, RESET_HOLD_MS, LINES_MS)) {
    log("No answer from the ROM; pulsed RTS in case it drives the reset");
    if (await link.link(AUTO_LINK_MS)) return link;
  }
  log("No answer from the ROM; waiting for download mode (TX2 to GND, then reset)");
  hooks.onWaiting?.();
  return (await link.link(STRAP_WAIT_MS)) ? link : null;
}

/**
 * Flash ``image`` onto the chip behind ``port`` (opened and closed here at
 * the speeds the ROM needs). A board already in download mode links at
 * once; otherwise RTS is pulsed in case it drives the reset, then the ROM is
 * polled until the user straps the board or ``signal`` aborts. The user then
 * resets the board to start the firmware.
 */
export async function flashAmbz(
  port: SerialPort,
  image: AmbzImage,
  hooks: LibreTinyFlashHooks
): Promise<void> {
  const log = hooks.onLog ?? (() => {});
  const session = new Session(port, hooks.signal);
  let failure: unknown;
  try {
    const rom = await enterDownloadMode(session, port, hooks, log);
    if (!rom) throw new AmbzLinkError();
    hooks.onLinked?.();
    // Read at the link speed: the ROM does not answer FLASH_READ at 115200.
    // The read has no checksum, and a garbled one would pick the slot the
    // bootloader skips (or be written back): read it twice and compare.
    const system = await rom.flashRead(SYSTEM_OFFSET, 1);
    if (!bytesEqual(await rom.flashRead(SYSTEM_OFFSET, 1), system)) {
      throw new Error("The system data read back differently; wrote nothing");
    }
    const { slot, rewrite } = pickSlot(system, image.ota2Offset);
    let link = await session.moveTo(WRITE_BAUD);
    if (rewrite) {
      log(
        `Pointing the system data at the second slot (${formatAddress(image.ota2Offset)})`
      );
      await link.memoryWrite(AMBZ_FLASH_ADDRESS | SYSTEM_OFFSET, rewrite);
      link = await session.resume();
    }
    const target = slot === 1 ? image.ota1 : image.ota2;
    log(
      `Linked to the ROM downloader; writing OTA slot ${slot} in ${target.runs.length} runs`
    );
    let done = 0;
    for (const run of target.runs) {
      log(`Writing ${formatAddress(run.address)} (${run.data.length} bytes)`);
      const tenth = tenthLogger(log, `Writing ${formatAddress(run.address)}`);
      await link.memoryWrite(AMBZ_FLASH_ADDRESS | run.address, run.data, {
        onBlock: (sent) => {
          hooks.onProgress(
            Math.min(99, Math.floor(((done + sent) / target.totalBytes) * 100))
          );
          tenth(Math.floor((sent / run.data.length) * 100));
        },
      });
      done += run.data.length;
      link = await session.resume();
    }
    // No RAM boot: the ROM's download state would survive into the firmware's next reboot.
    log("Written; reset the board to start the firmware");
    hooks.onProgress(100);
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    // A teardown failure must not replace the flash error nor skip the rest.
    await session.close(failure);
  }
}
