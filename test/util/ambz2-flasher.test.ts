import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Ambz2ConsoleError,
  Ambz2VerifyError,
  flashAmbz2,
} from "../../src/util/ambz2-flasher.js";
import type { LibreTinyImage } from "../../src/util/libretiny-uf2.js";

const STX = 0x02;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const enc = new TextEncoder();
const dec = new TextDecoder();
// Captured before the fake timers replace it: the driver needs a real turn.
const realSetTimeout = globalThis.setTimeout;
const last = <T>(items: T[]): T | undefined => items[items.length - 1];

interface RomOptions {
  /** Pings to ignore before the ROM answers (0: linked right after the reset). */
  linkAfterPings?: number;
  /** Answer every hash query with zeros. */
  badHash?: boolean;
  /** Answer pings from the SDK console instead of the ROM. */
  console?: boolean;
  /** Fail setSignals as an adapter without control lines would. */
  noSignals?: boolean;
}

/**
 * A scripted RTL8720C ROM behind a fake Web Serial port: text commands in
 * the writable are answered on the readable; ``fwd`` switches it into an
 * XModem receiver that ACKs every block and stores the bytes per offset.
 */
function fakeRom(opts: RomOptions = {}) {
  let out!: ReadableStreamDefaultController<Uint8Array>;
  const commands: string[] = [];
  const signals: SerialOutputSignals[] = [];
  const written = new Map<number, number[]>();
  let pings = 0;
  let xmodem: { offset: number; buf: number[] } | null = null;
  let text = "";
  const reply = (s: string | Uint8Array) =>
    out.enqueue(typeof s === "string" ? enc.encode(s) : s);

  const onLine = async (line: string) => {
    commands.push(line);
    const [cmd, ...args] = line.split(" ");
    if (cmd === "ping") {
      if (opts.console) reply("\r\n$8710c>\r\n$8710c>");
      else if (pings++ >= (opts.linkAfterPings ?? 0)) reply("ping");
    } else if (cmd === "DW") {
      reply(`${args[0]}: 00000020 00000000 00000000 00000000\r\n`);
    } else if (cmd === "EW") {
      reply(`0x${args[0]} = 0x${args[1]}\r\n`);
    } else if (cmd === "fwd") {
      xmodem = { offset: parseInt(args[2], 16), buf: [] };
      written.set(xmodem.offset, []);
      reply(new Uint8Array([NAK]));
    } else if (cmd === "hashq") {
      const length = Number(args[0]);
      const data = new Uint8Array(last([...written.values()])!.slice(0, length));
      const hash = opts.badHash
        ? new Uint8Array(32)
        : new Uint8Array(await crypto.subtle.digest("SHA-256", data));
      out.enqueue(new Uint8Array([...enc.encode("hashs "), ...hash]));
    }
  };

  const feed = async (chunk: Uint8Array) => {
    if (xmodem) {
      xmodem.buf.push(...chunk);
      for (;;) {
        if (xmodem.buf[0] === EOT) {
          xmodem = null;
          reply(new Uint8Array([ACK]));
          return;
        }
        if (xmodem.buf[0] === STX && xmodem.buf.length >= 1028) {
          const block = xmodem.buf.splice(0, 1028);
          written.get(xmodem.offset)!.push(...block.slice(3, 1027));
          reply(new Uint8Array([ACK]));
          continue;
        }
        return;
      }
    }
    text += dec.decode(chunk);
    let nl: number;
    while ((nl = text.indexOf("\n")) >= 0) {
      const line = text.slice(0, nl);
      text = text.slice(nl + 1);
      await onLine(line);
    }
  };

  // Like a freshly picked port: no streams until open().
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    open: vi.fn(async () => {
      port.readable = new ReadableStream<Uint8Array>({ start: (c) => (out = c) });
      port.writable = new WritableStream<Uint8Array>({ write: feed });
    }),
    close: vi.fn(async () => {}),
    setSignals: vi.fn(async (s: SerialOutputSignals) => {
      if (opts.noSignals) throw new DOMException("no lines", "NetworkError");
      signals.push(s);
    }),
  };
  return {
    port: port as unknown as SerialPort,
    raw: port,
    commands,
    signals,
    written,
    dropLink: () => out.close(),
  };
}

const run = (address: number, length: number, fill: number) => ({
  address,
  data: new Uint8Array(length).fill(fill),
});
const image: LibreTinyImage = {
  familyId: 0xe08f7564,
  board: "bw15",
  runs: [run(0xc000, 1500, 0xa5), run(0x4000, 100, 0x5a)],
  totalBytes: 1600,
};

/**
 * Drive the engine under fake timers to completion. The fake ROM hashes
 * with WebCrypto, which settles on a real event-loop turn, so timers are
 * re-run after each turn until the promise settles.
 */
async function drive<T>(p: Promise<T>): Promise<T> {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true)
  );
  while (!settled) {
    await vi.runAllTimersAsync();
    await new Promise((r) => realSetTimeout(r, 0));
  }
  return p;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("flashAmbz2", () => {
  it("resets through DTR/RTS, links, writes and verifies every run, then boots", async () => {
    const rom = fakeRom();
    const progress: number[] = [];
    const log: string[] = [];
    const onLinked = vi.fn();
    const onWaitingForStrap = vi.fn();
    await drive(
      flashAmbz2(rom.port, image, {
        onProgress: (p) => progress.push(p),
        onLog: (line) => log.push(line),
        onLinked,
        onWaitingForStrap,
      })
    );
    expect(log).toEqual([
      "Resetting the board into download mode over DTR/RTS",
      "Linked to the ROM downloader (flash config 0 1); 2 runs to write",
      "Writing 0xC000 (1500 bytes)",
      "Writing 0xC000: 68%",
      "Writing 0xC000: 100%",
      "Verified 0xC000 (SHA-256 matches)",
      "Writing 0x4000 (100 bytes)",
      "Writing 0x4000: 100%",
      "Verified 0x4000 (SHA-256 matches)",
      "Booting the firmware",
    ]);
    expect(rom.raw.open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(rom.signals).toEqual([
      { dataTerminalReady: true, requestToSend: true },
      { requestToSend: false },
      { dataTerminalReady: false, requestToSend: false },
    ]);
    expect(rom.commands).toEqual([
      "ping",
      "DW 40000038 1",
      "EW 40002800 7EFFFFFF",
      "fwd 0 1 c000",
      "ping",
      "hashq 1500 0 1",
      "fwd 0 1 4000",
      "ping",
      "hashq 100 0 1",
      "disc",
    ]);
    expect(rom.written.get(0xc000)!.slice(0, 1500)).toEqual([...image.runs[0].data]);
    // The tail block is padded with 0x1a, which the hash query ignores.
    expect(rom.written.get(0xc000)![1500]).toBe(0x1a);
    expect(rom.written.get(0x4000)!.slice(0, 100)).toEqual([...image.runs[1].data]);
    expect(onLinked).toHaveBeenCalledOnce();
    expect(onWaitingForStrap).not.toHaveBeenCalled();
    expect(last(progress)).toBe(100);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true);
    expect(rom.raw.close).toHaveBeenCalledOnce();
  });

  it("falls back to the strap guide and keeps polling until the ROM answers", async () => {
    const rom = fakeRom({ linkAfterPings: 25, noSignals: true });
    const onWaitingForStrap = vi.fn();
    const onLinked = vi.fn();
    await drive(
      flashAmbz2(rom.port, image, { onProgress: () => {}, onWaitingForStrap, onLinked })
    );
    expect(onWaitingForStrap).toHaveBeenCalledOnce();
    expect(onLinked).toHaveBeenCalledOnce();
    expect(rom.commands.filter((c) => c === "ping").length).toBeGreaterThan(25);
    expect(last(rom.commands)).toBe("disc");
  });

  it("fails the run whose hash does not match and drops the strap", async () => {
    const rom = fakeRom({ badHash: true });
    await expect(
      drive(flashAmbz2(rom.port, image, { onProgress: () => {} }))
    ).rejects.toBeInstanceOf(Ambz2VerifyError);
    expect(rom.commands).not.toContain("disc");
    expect(last(rom.signals)).toEqual({
      dataTerminalReady: false,
      requestToSend: false,
    });
    expect(rom.raw.close).toHaveBeenCalledOnce();
  });

  it("tells the SDK console apart from the ROM", async () => {
    const rom = fakeRom({ console: true });
    await expect(
      drive(flashAmbz2(rom.port, image, { onProgress: () => {} }))
    ).rejects.toBeInstanceOf(Ambz2ConsoleError);
  });

  it("stops on abort and releases the port", async () => {
    const rom = fakeRom({ linkAfterPings: 1000 });
    const abort = new AbortController();
    const p = flashAmbz2(rom.port, image, { onProgress: () => {}, signal: abort.signal });
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(3000);
    abort.abort();
    await expect(drive(p)).rejects.toMatchObject({ name: "AbortError" });
    expect(rom.commands).not.toContain("fwd 0 1 c000");
    expect(rom.raw.close).toHaveBeenCalledOnce();
  });

  it("fails when the port goes away mid-transfer", async () => {
    const rom = fakeRom({ linkAfterPings: 1000 });
    const p = flashAmbz2(rom.port, image, { onProgress: () => {} });
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    rom.dropLink();
    await expect(drive(p)).rejects.toThrow(/Serial port closed/);
    expect(rom.raw.close).toHaveBeenCalledOnce();
  });
});
