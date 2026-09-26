/**
 * Flashing a Realtek AmebaZ2 (RTL8720C) over Web Serial through the ROM's
 * UART download console, the protocol ltchiptool speaks for this family:
 * ``ping`` to link, ``DW`` / ``EW`` register access to set the flash up,
 * ``fwd`` + XModem-1k per run, ``hashq`` to verify, ``disc`` to boot. Loaded
 * on demand by the install flow; nothing here touches the DOM.
 */
import { formatAddress, tenthLogger } from "./flash-log.js";
import type { LibreTinyImage } from "./libretiny-uf2.js";
import { SerialStreamSession } from "./serial-stream-session.js";
import { sleep } from "./sleep.js";
import { type XmodemIo, xmodemSend } from "./xmodem.js";

const AMBZ2_BAUD_RATE = 115200;
/** How long the automatic DTR/RTS reset gets to produce a linked ROM. */
const AUTO_LINK_MS = 2000;
/**
 * The automatic reset is tried this many times before the strap guide: on
 * macOS a CH340's first session after a replug does not reach the wire, so
 * the first pulse is often lost.
 */
const AUTO_RESET_ATTEMPTS = 3;
/** Relinking after a transfer; the ROM answers within a second normally. */
const RELINK_MS = 10000;
/** The strap guide keeps polling this long before giving up. */
const STRAP_WAIT_MS = 5 * 60 * 1000;
const PING_QUIET_MS = 150;
const PING_WINDOW_MS = 400;
const RESET_HOLD_MS = 100;
const ROM_SETTLE_MS = 400;
const LINE_MS = 1000;
const XMODEM_TIMEOUT_MS = 3000;
const HASH_LENGTH = 32;
// SYSCFG: bits 5..6 hold the flash pinout, which the ROM wants named back in
// every flash command; the second write unlocks the flash controller.
const REG_FLASH_MODE = 0x40000038;
const REG_FLASH_UNLOCK = 0x40002800;
const FLASH_UNLOCK_VALUE = 0x7effffff;

export interface Ambz2FlashHooks {
  onProgress: (percent: number) => void;
  /** One line per step, for the install dialog's details log. */
  onLog?: (line: string) => void;
  /** The chip is linked and the write is starting. */
  onLinked?: () => void;
  /** The automatic reset produced nothing; the user has to strap the board. */
  onWaitingForStrap?: () => void;
  signal?: AbortSignal;
}

/** No ROM answered while the user had the chance to enter download mode. */
export class Ambz2LinkError extends Error {
  constructor(message = "The chip did not enter download mode") {
    super(message);
    this.name = "Ambz2LinkError";
  }
}

/** The chip answered from the SDK console rather than the ROM downloader. */
export class Ambz2ConsoleError extends Error {
  constructor() {
    super("The chip answered from its SDK console, not the ROM download mode");
    this.name = "Ambz2ConsoleError";
  }
}

export class Ambz2VerifyError extends Error {
  constructor(address: number) {
    super(`Flash contents at 0x${address.toString(16)} do not match the image`);
    this.name = "Ambz2VerifyError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Byte-level access to the port: the read loop feeds a buffer that the
 * command helpers consume with timeouts.
 */
class RomLink extends SerialStreamSession implements XmodemIo {
  private buf: number[] = [];
  private wake: (() => void) | null = null;

  protected onBytes(bytes: Uint8Array): void {
    for (const b of bytes) this.buf.push(b);
    this.wake?.();
  }

  protected onEnded(): void {
    this.wake?.();
  }

  /** Resolves true when bytes arrived, false on timeout; throws once the port is gone. */
  private waitForData(timeoutMs: number): Promise<boolean> {
    if (this.readEnded) return Promise.reject(this.readEnded);
    let timer: ReturnType<typeof setTimeout>;
    const arrived = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve(true);
      };
    });
    return this.race(arrived).then((got) => {
      if (got && this.readEnded && this.buf.length === 0) throw this.readEnded;
      return got;
    });
  }

  async write(data: Uint8Array | string): Promise<void> {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    await this.writeBytes(bytes);
  }

  drain(): void {
    this.buf = [];
  }

  async readByte(timeoutMs: number): Promise<number | null> {
    if (this.buf.length === 0 && !(await this.waitForData(timeoutMs))) return null;
    return this.buf.shift() ?? null;
  }

  /** Exactly ``count`` bytes; the timeout restarts with every arrival. */
  async readBytes(count: number, timeoutMs: number): Promise<Uint8Array> {
    while (this.buf.length < count) {
      if (!(await this.waitForData(timeoutMs))) {
        throw new Error(`Timed out waiting for ${count} bytes (got ${this.buf.length})`);
      }
    }
    return new Uint8Array(this.buf.splice(0, count));
  }

  /** Everything received until ``quietMs`` of silence, at most ``windowMs``. */
  async readQuiet(quietMs: number, windowMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      const wait = Math.min(quietMs, deadline - Date.now());
      if (!(await this.waitForData(wait)) && this.buf.length > 0) break;
    }
    return new Uint8Array(this.buf.splice(0));
  }

  /** The next non-empty line, CR/LF stripped. */
  async readLine(timeoutMs: number): Promise<string> {
    for (;;) {
      const nl = this.buf.indexOf(0x0a);
      if (nl >= 0) {
        const line = decoder.decode(new Uint8Array(this.buf.splice(0, nl + 1))).trim();
        if (line) return line;
        continue;
      }
      if (!(await this.waitForData(timeoutMs))) {
        throw new Error("Timed out waiting for a response line");
      }
    }
  }
}

/**
 * Boards wired like the BW15 kit tie RTS to CEN and DTR to PA00, so holding
 * DTR through an RTS pulse boots the ROM downloader. Adapters without those
 * lines ignore this, and the strap guide covers them. False when the adapter
 * has no control lines to drive.
 */
async function autoReset(port: SerialPort): Promise<boolean> {
  try {
    await port.setSignals({ dataTerminalReady: true, requestToSend: true });
    await sleep(RESET_HOLD_MS);
    await port.setSignals({ requestToSend: false });
    await sleep(ROM_SETTLE_MS);
    return true;
  } catch {
    return false;
  }
}

/** Reset into download mode over DTR/RTS, retrying; true once the ROM answers. */
async function autoLink(
  port: SerialPort,
  rom: RomLink,
  log: (line: string) => void
): Promise<boolean> {
  for (let attempt = 1; attempt <= AUTO_RESET_ATTEMPTS; attempt++) {
    log(
      attempt === 1
        ? "Resetting the board into download mode over DTR/RTS"
        : `No answer from the ROM; resetting again (attempt ${attempt} of ${AUTO_RESET_ATTEMPTS})`
    );
    const driven = await autoReset(port);
    if (await linkRom(rom, AUTO_LINK_MS)) return true;
    if (!driven) return false;
  }
  return false;
}

/**
 * Release the strap and pulse reset so the board comes up in the firmware.
 * False when the lines could not be driven (no control lines on this
 * adapter, or the port is gone): the board is still in the ROM and the
 * user has to reset it.
 */
async function bootFirmware(port: SerialPort): Promise<boolean> {
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await sleep(RESET_HOLD_MS);
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    return true;
  } catch {
    return false;
  }
}

/** One ping; true when the ROM downloader answered. */
async function ping(rom: RomLink): Promise<boolean> {
  rom.drain();
  await rom.write("ping\n");
  const reply = decoder.decode(await rom.readQuiet(PING_QUIET_MS, PING_WINDOW_MS));
  if (reply.includes("$8710c")) throw new Ambz2ConsoleError();
  return reply === "ping";
}

/**
 * Ping until the ROM answers or ``timeoutMs`` passes. A running LibreTiny
 * firmware reboots into download mode on the same ``ping`` line, so this
 * doubles as that trigger.
 */
async function linkRom(rom: RomLink, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await ping(rom)) return true;
  } while (Date.now() < deadline);
  return false;
}

async function readRegister(link: RomLink, address: number): Promise<number> {
  link.drain();
  await link.write(`DW ${address.toString(16).toUpperCase()} 1\n`);
  const expect = `${address.toString(16).toUpperCase()}:`;
  for (let i = 0; i < 4; i++) {
    const words = (await link.readLine(LINE_MS)).split(/\s+/);
    if (words[0].toUpperCase() === expect && /^[0-9a-f]{1,8}$/i.test(words[1] ?? "")) {
      return parseInt(words[1], 16);
    }
  }
  throw new Error(`Unexpected reply reading register 0x${address.toString(16)}`);
}

async function writeRegister(
  link: RomLink,
  address: number,
  value: number
): Promise<void> {
  const hexAddress = address.toString(16).toUpperCase();
  const hexValue = value.toString(16).toUpperCase();
  link.drain();
  await link.write(`EW ${hexAddress} ${hexValue}\n`);
  // The ROM echoes the write back as "0x<address> = 0x<value>", possibly
  // after a stray line.
  for (let i = 0; i < 4; i++) {
    const reply = (await link.readLine(LINE_MS)).toUpperCase();
    if (reply.includes(hexAddress) && reply.includes(hexValue)) return;
  }
  throw new Error(`Register write to 0x${hexAddress} was not acknowledged`);
}

/** Sets the flash controller up and returns the ``<speed> <mode>`` the ROM wants back. */
async function flashInit(link: RomLink): Promise<string> {
  const mode = ((await readRegister(link, REG_FLASH_MODE)) >> 5) & 0b11;
  await writeRegister(link, REG_FLASH_UNLOCK, FLASH_UNLOCK_VALUE);
  return `0 ${mode}`;
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

async function readFlashHash(
  link: RomLink,
  cfg: string,
  length: number
): Promise<Uint8Array> {
  // The ROM hashes at roughly 1.5 Mbit/s and answers only when done.
  const timeout = Math.max(LINE_MS, Math.ceil(length / 150_000) * 1000 + 500);
  link.drain();
  await link.write(`hashq ${length} ${cfg}\n`);
  const reply = await link.readBytes(6 + HASH_LENGTH, timeout);
  if (decoder.decode(reply.subarray(0, 6)) !== "hashs ") {
    throw new Error("Unexpected reply to the hash query");
  }
  return reply.subarray(6);
}

async function writeRun(
  link: RomLink,
  cfg: string,
  address: number,
  data: Uint8Array<ArrayBuffer>,
  onBytes: (sent: number) => void,
  log: (line: string) => void
): Promise<void> {
  log(`Writing ${formatAddress(address)} (${data.length} bytes)`);
  const tenth = tenthLogger(log, `Writing ${formatAddress(address)}`);
  link.drain();
  await link.write(`fwd ${cfg} ${address.toString(16)}\n`);
  await xmodemSend(link, data, {
    timeoutMs: XMODEM_TIMEOUT_MS,
    onBlock: (sent) => {
      onBytes(sent);
      tenth(Math.floor((sent / data.length) * 100));
    },
  });
  if (!(await linkRom(link, RELINK_MS))) {
    throw new Ambz2LinkError("The chip stopped answering after the transfer");
  }
  const expected = await sha256(data);
  const actual = await readFlashHash(link, cfg, data.length);
  if (expected.some((b, i) => b !== actual[i])) throw new Ambz2VerifyError(address);
  log(`Verified ${formatAddress(address)} (SHA-256 matches)`);
}

/**
 * Flash ``image`` onto the chip behind ``port`` (opened here at 115200 if
 * needed, closed after). The automatic reset is tried first; failing that
 * the ROM is polled until the user straps the board or ``signal`` aborts.
 * Resolves true once the board was rebooted into the firmware, false when
 * the adapter has no control lines to do that and the user must reset it.
 */
export async function flashAmbz2(
  port: SerialPort,
  image: LibreTinyImage,
  hooks: Ambz2FlashHooks
): Promise<boolean> {
  if (!port.readable) await port.open({ baudRate: AMBZ2_BAUD_RATE });
  const log = hooks.onLog ?? (() => {});
  let rom: RomLink | undefined;
  let failure: unknown;
  let rebooted = false;
  try {
    rom = new RomLink(port, hooks.signal);
    if (!(await autoLink(port, rom, log))) {
      log("No answer from the ROM; waiting for download mode (PA00 to 3.3V, then reset)");
      hooks.onWaitingForStrap?.();
      if (!(await linkRom(rom, STRAP_WAIT_MS))) throw new Ambz2LinkError();
    }
    hooks.onLinked?.();
    const cfg = await flashInit(rom);
    log(
      `Linked to the ROM downloader (flash config ${cfg}); ${image.runs.length} runs to write`
    );
    let done = 0;
    for (const run of image.runs) {
      await writeRun(
        rom,
        cfg,
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
    // Ends the ROM session; no reply comes back. The reboot itself happens
    // in the teardown below, with the strap released.
    await rom.write("disc\n");
    hooks.onProgress(100);
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    // A teardown failure must not replace the flash error nor skip the rest.
    await rom?.close(failure).catch(() => {});
    // DTR still holds the strap, so a reset now would land in the ROM again:
    // release it, then pulse RTS so the board comes up in the firmware.
    rebooted = await bootFirmware(port);
    if (failure === undefined) {
      log(
        rebooted
          ? "Rebooting into the firmware"
          : "No control lines to reboot the board; release PA00 and reset it by hand"
      );
    }
    await port.close().catch(() => {});
  }
  return rebooted;
}
