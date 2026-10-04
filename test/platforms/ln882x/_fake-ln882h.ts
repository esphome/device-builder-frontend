/**
 * A simulated LN882H behind a fake Web Serial port, the same model as
 * ``fixtures/record.py``: the BootROM answers ``version`` and takes the RAM
 * code over YMODEM; the RAM code echoes what it is sent and answers
 * ``version``, ``flash_info``, ``startaddr``, ``upgrade`` (YMODEM into the
 * flash) and ``reboot``, as the SDK's ramcode_dl sources do.
 */
import { vi } from "vitest";
import { disconnectEvents } from "../../_web-serial.js";
import { crc16Xmodem } from "../../../src/util/xmodem.js";

const FLASH_SIZE = 0x200000;
const ROM_VERSION = "Mar 14 2021/12:34:56";
const FLASH_ID = 0xeb6015;
const SECTOR = 0x1000;
const SOH = 0x01;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const C = 0x43;
const enc = new TextEncoder();

/** What the flash holds before the flash: never FF, so an erase shows. */
const oldByte = (i: number) => (i * 7 + 3) % 251;
/** The image's bytes, by offset in its run. */
const newByte = (i: number) => (i * 31 + 7) % 253;
/** The stand-in RAM code's bytes. */
const ramcodeByte = (i: number) => (i * 13 + 5) % 256;

export const RAMCODE = Uint8Array.from({ length: 1000 }, (_, i) => ramcodeByte(i));

export interface Frame {
  dir: "tx" | "rx";
  bytes: Uint8Array;
}

export interface FakeOptions {
  /**
   * Where the chip is when the port opens: already in the ROM downloader
   * (strapped by hand), running its firmware (silent until a reset with
   * BOOT held), or in the RAM code from an earlier attempt.
   */
  start?: "rom" | "firmware" | "ramcode";
  /** Fail setSignals as an adapter without control lines would. */
  noSignals?: boolean;
  /** Never settle a line change, as on a board unplugged mid change. */
  hangSignals?: boolean;
  /**
   * A dev board whose adapter drives CEN from RTS and BOOT from DTR (both
   * active low). Otherwise the lines go nowhere, as on an adapter wired to
   * TX, RX and GND alone.
   */
  wired?: boolean;
  /** Resets over the lines that do not reach the chip before one does. */
  lostResets?: number;
  /** Pings the firmware ignores before the user's strap lands it in the ROM. */
  strapAfterPings?: number;
  /** The ROM takes the RAM code and stays the ROM. */
  ramBootFails?: boolean;
  /** NAK the first data block of every transfer once. */
  nakFirstBlock?: boolean;
  /** Refuse every start address. */
  startaddrFails?: boolean;
  /** Say nothing to ``reboot``. */
  silentReboot?: boolean;
  /** Answer ``flash_info`` with this line instead. */
  flashInfo?: string;
  /** Stop answering ``version`` once the RAM code took this many transfers. */
  deafAfterUpgrades?: number;
}

interface Ymodem {
  target: "ram" | "flash";
  buf: number[];
  packets: number;
  eot: number;
  length: number;
  data: number[];
  naked: boolean;
}

export function fakeLn882h(opts: FakeOptions = {}) {
  let out!: ReadableStreamDefaultController<Uint8Array>;
  const frames: Frame[] = [];
  const signals: SerialOutputSignals[] = [];
  const flash = Uint8Array.from({ length: FLASH_SIZE }, (_, i) => oldByte(i));
  let mode: "rom" | "firmware" | "ramcode" = opts.start ?? "rom";
  let ymodem: Ymodem | null = null;
  let line = "";
  let startAddr = 0;
  let ram = new Uint8Array(0);
  let rebooted = false;
  let pings = 0;
  let upgrades = 0;
  let resets = 0;
  let dtr = false;
  let rts = false;

  const reply = (data: Uint8Array | string | number[]) => {
    const bytes =
      typeof data === "string"
        ? enc.encode(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data);
    frames.push({ dir: "rx", bytes });
    out.enqueue(bytes);
  };

  const startYmodem = (target: Ymodem["target"]) => {
    ymodem = { target, buf: [], packets: 0, eot: 0, length: 0, data: [], naked: false };
    reply([C]);
  };

  const command = (cmd: string) => {
    const words = cmd.split(" ");
    if (mode === "firmware") {
      if (cmd === "version" && pings++ >= (opts.strapAfterPings ?? Infinity)) {
        mode = "rom";
      } else return;
    }
    if (mode === "rom") {
      if (cmd === "version") reply(`\r\n${ROM_VERSION}\r\n`);
      else if (words[0] === "download" && words[1] === "[rambin]") startYmodem("ram");
      return;
    }
    if (cmd === "version") {
      if (upgrades < (opts.deafAfterUpgrades ?? Infinity)) reply("\r\nRAMCODE\r\n");
    } else if (cmd === "flash_info") {
      reply(
        opts.flashInfo ??
          `\r\nid:0x${FLASH_ID.toString(16).toUpperCase()},flash size:2M Byte\r\n`
      );
    } else if (words[0] === "startaddr" && words.length > 1) {
      startAddr = parseInt(words[1], 16);
      reply(opts.startaddrFails ? "\r\nffff\r\n" : "\r\npppp\r\n");
    } else if (cmd === "upgrade") {
      startYmodem("flash");
    } else if (cmd === "reboot") {
      if (!opts.silentReboot) reply("\r\npppp\r\n");
      rebooted = true;
    }
  };

  const ymodemDone = () => {
    const y = ymodem!;
    ymodem = null;
    const data = new Uint8Array(y.data.slice(0, y.length));
    if (y.target === "ram") {
      ram = data;
      if (!opts.ramBootFails) mode = "ramcode";
    } else {
      flash.set(data, startAddr);
      upgrades++;
    }
  };

  const ymodemFeed = (chunk: Uint8Array) => {
    const y = ymodem!;
    y.buf.push(...chunk);
    while (y.buf.length) {
      if (y.buf[0] === EOT) {
        y.buf.shift();
        y.eot++;
        reply(y.eot === 1 ? [NAK] : [ACK, C]);
        continue;
      }
      if (y.buf[0] !== SOH || y.buf.length < 133) return;
      const block = new Uint8Array(y.buf.splice(0, 133));
      const seq = block[1];
      const payload = block.subarray(3, 131);
      if (
        seq + block[2] !== 0xff ||
        crc16Xmodem(payload) !== ((block[131] << 8) | block[132])
      ) {
        reply([NAK]);
        continue;
      }
      if (y.packets === 0) {
        const nul = payload.indexOf(0);
        const fields = new TextDecoder().decode(payload.subarray(nul + 1)).split(" ");
        y.length = parseInt(fields[0], 10);
        if (y.target === "flash") {
          const length = Math.ceil(y.length / SECTOR) * SECTOR;
          flash.fill(0xff, startAddr, startAddr + length);
        }
        reply([ACK, C]);
      } else if (y.eot > 1 && seq === 0) {
        reply([ACK]);
        ymodemDone();
        return;
      } else {
        if (opts.nakFirstBlock && !y.naked) {
          y.naked = true;
          reply([NAK]);
          continue;
        }
        y.data.push(...payload);
        reply([ACK]);
      }
      y.packets++;
    }
  };

  const feed = (chunk: Uint8Array) => {
    frames.push({ dir: "tx", bytes: new Uint8Array(chunk) });
    if (ymodem) {
      ymodemFeed(chunk);
      return;
    }
    if (mode === "ramcode") {
      const echo = [...chunk].filter((b) => b >= 0x20 && b < 0x7f);
      if (echo.length) reply(echo);
    }
    for (const byte of chunk) {
      if (byte === 0x0d || byte === 0x0a) {
        const cmd = line;
        line = "";
        if (cmd) command(cmd);
      } else {
        line += String.fromCharCode(byte);
      }
    }
  };

  // Like a freshly picked port: no streams until open().
  const port = {
    ...disconnectEvents(),
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    open: vi.fn(async () => {
      port.readable = new ReadableStream<Uint8Array>({ start: (c) => (out = c) });
      port.writable = new WritableStream<Uint8Array>({ write: feed });
      // Chromium asserts both lines on open.
      dtr = rts = true;
    }),
    close: vi.fn(async () => {}),
    setSignals: vi.fn(async (s: SerialOutputSignals) => {
      if (opts.hangSignals) await new Promise(() => {});
      if (opts.noSignals) throw new DOMException("no lines", "NetworkError");
      signals.push(s);
      if (!opts.wired) return;
      const wasInReset = rts;
      if (s.dataTerminalReady !== undefined) dtr = s.dataTerminalReady;
      if (s.requestToSend !== undefined) rts = s.requestToSend;
      // CEN released: the BootROM reads BOOT (held low by DTR) as it starts.
      if (wasInReset && !rts && resets++ >= (opts.lostResets ?? 0)) {
        mode = dtr ? "rom" : "firmware";
        ymodem = null;
        line = "";
      }
    }),
  };
  return {
    port: port as unknown as SerialPort,
    raw: port,
    frames,
    signals,
    flash,
    ram: () => ram,
    rebooted: () => rebooted,
    dropLink: () => out.close(),
  };
}

/** One run from 0 as a build's starts, and a short second one: the fixture's image. */
export const referenceRuns = () => [
  { address: 0x0, data: Uint8Array.from({ length: 3 * 128 + 50 }, (_, i) => newByte(i)) },
  { address: 0x7000, data: Uint8Array.from({ length: 300 }, (_, i) => newByte(i + 7)) },
];
