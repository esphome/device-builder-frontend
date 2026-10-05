/**
 * A simulated RTL8710B behind a fake Web Serial port, the same model as
 * ``fixtures/record.py``: the ROM downloader NAKs while it idles in its loud
 * handshake, answers FLASH_GET_STATUS, SET_BAUD_RATE and FLASH_READ, and takes
 * address-prefixed XModem-1k blocks into flash (ACKing the end) or RAM
 * (booting instead). A running LibreTiny firmware reboots into it on the
 * download magic at 115200.
 */
import { vi } from "vitest";
import { disconnectEvents } from "../../_web-serial.js";

const FLASH_SIZE = 0x200000;
const SYSTEM = 0x9000;
const NAK = 0x15;
const ACK = 0x06;
const STX = 0x02;
const EOT = 0x04;
const CAN = 0x18;
const ROM_BAUD = 1500000;
const IDLE_NAKS = 8;
const MAGIC = [0x55, 0xaa, 0x22, 0xe0, 0xd6, 0xfc];

/** What the flash holds before the flash: never FF, so an erase shows. */
const oldByte = (i: number) => (i * 7 + 3) % 251;

export interface Frame {
  dir: "tx" | "rx";
  bytes: Uint8Array;
}

export interface FakeAmbzOptions {
  /** In the ROM already (strapped by hand), or running a LibreTiny firmware. */
  start?: "rom" | "firmware";
  /** The system data's ota2 address and switch (record.py's cases). */
  ota2Address?: number;
  ota2Switch?: number;
  /** A firmware that does not reboot on the magic (the strap is needed). */
  ignoresMagic?: boolean;
  /** NAK the first block of every flash transfer once. */
  nakFirstBlock?: boolean;
  /** Fail setSignals as an adapter without control lines would. */
  noSignals?: boolean;
  /**
   * The receiver is ready only this long after the XModem handshake, then
   * NAKs for the first block (as an RTL8710BX does); a block before is lost.
   */
  readyAfterMs?: number;
  /** Garble one byte of the first FLASH_READ, as a noisy line would. */
  garblesFirstRead?: boolean;
}

export function fakeAmbz(opts: FakeAmbzOptions = {}) {
  let out: ReadableStreamDefaultController<Uint8Array> | null = null;
  const frames: Frame[] = [];
  const bauds: number[] = [];
  const signals: SerialOutputSignals[] = [];
  const flash = Uint8Array.from({ length: FLASH_SIZE }, (_, i) => oldByte(i));
  flash.fill(0xff, SYSTEM, SYSTEM + 0x1000);
  const sys = new DataView(flash.buffer, SYSTEM, 8);
  sys.setUint32(0, opts.ota2Address ?? 0x08080000, true);
  sys.setUint32(4, opts.ota2Switch ?? 0xffffffff, true);
  for (let i = 0; i < 0x10; i++) flash[SYSTEM + 0x100 + i] = i;
  let mode: "rom" | "firmware" | "booted" = opts.start ?? "rom";
  let baud = 0;
  let loud = mode === "rom";
  let prev = 0;
  let pending: number[] = [];
  let reading: { at: number; left: number } | null = null;
  let xmodem: number[] | null = null;
  let lastTarget: "flash" | "ram" = "flash";
  let naked = false;
  let readyAt = 0;
  let magic = 0;
  let reads = 0;

  const reply = (data: number[] | Uint8Array) => {
    const bytes = new Uint8Array(data);
    frames.push({ dir: "rx", bytes });
    out?.enqueue(bytes);
  };

  /** The loud handshake NAKs on its own while the ROM idles at its speed. */
  const idle = () => {
    if (mode !== "rom" || baud !== ROM_BAUD || !loud) return;
    reply(new Array(IDLE_NAKS).fill(NAK));
    loud = false;
  };

  const sendChunk = () => {
    const r = reading!;
    if (r.left === 0) {
      reading = null;
      return;
    }
    const chunk = flash.slice(r.at, r.at + 1024);
    if (opts.garblesFirstRead && reads === 1) chunk[0x50] ^= 0xff;
    reply(chunk);
    r.at += 1024;
    r.left -= 1024;
  };

  const xmodemByte = (byte: number) => {
    if (Date.now() < readyAt) return; // not listening yet
    const x = xmodem!;
    if (x.length === 0 && byte === EOT) {
      xmodem = null;
      if (lastTarget === "ram") mode = "booted";
      else reply([ACK]);
      return;
    }
    x.push(byte);
    if (x.length < 1032) return;
    const block = x.splice(0);
    if (block[0] !== STX || block[1] + block[2] !== 0xff) throw new Error("block header");
    const payload = block.slice(3, 1031);
    if ((payload.reduce((a, b) => a + b, 0) & 0xff) !== block[1031]) {
      throw new Error("checksum");
    }
    const address =
      (payload[0] | (payload[1] << 8) | (payload[2] << 16) | (payload[3] << 24)) >>> 0;
    if (address >>> 24 === 0x08) {
      if (opts.nakFirstBlock && !naked) {
        naked = true;
        reply([NAK]);
        return;
      }
      lastTarget = "flash";
      flash.set(payload.slice(4), address & 0xffffff);
    } else {
      lastTarget = "ram";
    }
    reply([ACK]);
  };

  const start = (byte: number) => {
    if (byte === CAN) {
      loud = true;
      idle();
    } else if (byte === 0x07 && prev === CAN) {
      // the middle of the disconnect sequence
    } else if (byte === 0x07) {
      reply([ACK]);
      xmodem = [];
      if (opts.readyAfterMs !== undefined) {
        readyAt = Date.now() + opts.readyAfterMs;
        setTimeout(() => reply([NAK]), opts.readyAfterMs);
      }
    } else if (byte === 0x21) {
      reply([0x00, NAK, NAK, NAK, NAK, NAK]);
    } else if (byte === 0x05 || byte === 0x19) {
      pending = [byte];
    } else if (byte === ACK && reading) {
      sendChunk();
    }
  };

  const argument = () => {
    if (pending[0] === 0x05 && pending.length === 2) {
      pending = [];
      reply([ACK]);
    } else if (pending[0] === 0x19 && pending.length === 6) {
      const offset = pending[1] | (pending[2] << 8) | (pending[3] << 16);
      const count = (pending[4] | (pending[5] << 8)) * 4096;
      pending = [];
      reading = { at: offset, left: count };
      reads++;
      sendChunk();
    }
  };

  const feed = (chunk: Uint8Array) => {
    frames.push({ dir: "tx", bytes: new Uint8Array(chunk) });
    for (const byte of chunk) {
      if (mode === "firmware") {
        // LibreTiny's UART2 matches the magic only at the log speed.
        magic =
          baud === 115200 && byte === MAGIC[magic]
            ? magic + 1
            : byte === MAGIC[0]
              ? 1
              : 0;
        if (magic === MAGIC.length && !opts.ignoresMagic) {
          mode = "rom";
          loud = true;
          magic = 0;
        }
      } else if (mode === "rom") {
        if (xmodem) xmodemByte(byte);
        else if (pending.length) {
          pending.push(byte);
          argument();
        } else start(byte);
      }
      prev = byte;
    }
  };

  // Like a freshly picked port: no streams until open(), none after close().
  const port = {
    ...disconnectEvents(),
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    open: vi.fn(async ({ baudRate }: SerialOptions) => {
      if (port.readable) throw new DOMException("already open", "InvalidStateError");
      baud = baudRate;
      bauds.push(baudRate);
      port.readable = new ReadableStream<Uint8Array>({ start: (c) => (out = c) });
      port.writable = new WritableStream<Uint8Array>({ write: feed });
      idle();
    }),
    close: vi.fn(async () => {
      try {
        out?.close();
      } catch {
        // already closed by the reader's cancel
      }
      out = null;
      port.readable = null;
      port.writable = null;
    }),
    setSignals: vi.fn(async (s: SerialOutputSignals) => {
      if (opts.noSignals) throw new DOMException("no lines", "NetworkError");
      signals.push(s);
    }),
  };
  return {
    port: port as unknown as SerialPort,
    raw: port,
    frames,
    bauds,
    signals,
    flash,
    booted: () => mode === "booted",
    /** The user's strap: the next open at the ROM's speed finds it in download mode. */
    strap: () => {
      mode = "rom";
      loud = true;
      idle();
    },
    dropLink: () => out?.close(),
  };
}

/** The recorded fixture's UF2 (record.py builds it), read from the repo root as the tests run. */
export async function fixtureUf2(): Promise<Uint8Array> {
  // @ts-expect-error - node-only module (see gen-language-manifest.test.ts)
  const { readFileSync } = await import("node:fs");
  return new Uint8Array(readFileSync("test/platforms/rtl87xx/fixtures/ambz.uf2"));
}
