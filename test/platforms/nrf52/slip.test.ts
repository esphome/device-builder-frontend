import { describe, expect, it } from "vitest";
import { disconnectEvents } from "../../_web-serial.js";

import {
  slipDecode,
  slipEncode,
  SlipFrameSession,
} from "../../../src/platforms/nrf52/slip.js";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("SLIP framing", () => {
  it("escapes END and ESC bytes", () => {
    expect([...slipEncode(bytes(0x01, 0xc0, 0x02, 0xdb, 0x03))]).toEqual([
      0x01, 0xdb, 0xdc, 0x02, 0xdb, 0xdd, 0x03,
    ]);
  });

  it("round-trips arbitrary payloads", () => {
    const payload = bytes(0xc0, 0xdb, 0xdc, 0xdd, 0x00, 0xff, 0xc0);
    expect([...slipDecode(slipEncode(payload))]).toEqual([...payload]);
  });

  it("rejects a truncated escape sequence", () => {
    expect(() => slipDecode(bytes(0x01, 0xdb))).toThrow(/Truncated/);
  });
});

describe("SlipFrameSession", () => {
  class Frames extends SlipFrameSession {
    frames: number[][] = [];

    protected onFrame(frame: Uint8Array): void {
      this.frames.push([...frame]);
    }
  }

  async function sessionFed(...chunks: number[][]) {
    let rx!: ReadableStreamDefaultController<Uint8Array>;
    const port = {
      ...disconnectEvents(),
      readable: new ReadableStream<Uint8Array>({ start: (c) => (rx = c) }),
      writable: new WritableStream<Uint8Array>(),
    } as unknown as SerialPort;
    const session = new Frames(port);
    for (const chunk of chunks) rx.enqueue(bytes(...chunk));
    rx.close();
    await new Promise((r) => setTimeout(r, 5));
    await session.close();
    return session.frames;
  }

  it("splits the bytes into decoded frames, across chunk boundaries", async () => {
    expect(
      await sessionFed([0x60, 0x09, 0x01], [0x05, 0xc0, 0x60], [0x07, 0xdb, 0xdc, 0xc0])
    ).toEqual([
      [0x60, 0x09, 0x01, 0x05],
      [0x60, 0x07, 0xc0],
    ]);
  });

  it("drops empty frames and ones that do not decode", async () => {
    expect(await sessionFed([0xc0, 0xc0, 0x01, 0xdb, 0xc0, 0x02, 0xc0])).toEqual([
      [0x02],
    ]);
  });
});
