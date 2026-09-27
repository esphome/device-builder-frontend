import { describe, expect, it } from "vitest";
import { buildSmpFrame } from "../../../src/platforms/nrf52/smp-protocol.js";
import {
  encodeSerialFrame,
  SmpSerialDecoder,
} from "../../../src/platforms/nrf52/smp-serial.js";

const lines = (encoded: Uint8Array): Uint8Array[] => {
  const out: Uint8Array[] = [];
  let start = 0;
  encoded.forEach((byte, i) => {
    if (byte !== 0x0a) return;
    out.push(encoded.slice(start, i));
    start = i + 1;
  });
  return out;
};

function decode(...chunks: Uint8Array[]): Uint8Array[] {
  const frames: Uint8Array[] = [];
  const decoder = new SmpSerialDecoder((frame) => frames.push(frame));
  for (const chunk of chunks) decoder.push(chunk);
  return frames;
}

const ascii = (text: string) => new TextEncoder().encode(text);

describe("encodeSerialFrame", () => {
  it("wraps a frame in a length prefix and the CRC16 of its bytes", () => {
    // CRC16 (poly 0x1021, init 0) of "123456789" is 0x31c3.
    const [line] = lines(encodeSerialFrame(ascii("123456789")));
    expect([...line.slice(0, 2)]).toEqual([0x06, 0x09]);
    const raw = atob(new TextDecoder().decode(line.slice(2)));
    expect([...raw].map((c) => c.charCodeAt(0))).toEqual([
      0x00,
      11,
      ...ascii("123456789"),
      0x31,
      0xc3,
    ]);
  });

  it("gives an empty frame a zero CRC", () => {
    const [line] = lines(encodeSerialFrame(new Uint8Array(0)));
    const raw = atob(new TextDecoder().decode(line.slice(2)));
    expect([...raw].map((c) => c.charCodeAt(0))).toEqual([0x00, 2, 0x00, 0x00]);
  });

  it("splits a long frame into lines the device's buffer takes", () => {
    const frame = buildSmpFrame(2, 1, 1, 0, { data: new Uint8Array(300), off: 0 });
    const encoded = lines(encodeSerialFrame(frame));
    expect(encoded.length).toBeGreaterThan(1);
    expect([...encoded[0].slice(0, 2)]).toEqual([0x06, 0x09]);
    for (const line of encoded.slice(1)) {
      expect([...line.slice(0, 2)]).toEqual([0x04, 0x14]);
    }
    // Two marker bytes, the base64 and the newline, in a 128-byte buffer.
    for (const line of encoded) expect(line.length + 1).toBeLessThanOrEqual(128);
  });
});

describe("SmpSerialDecoder", () => {
  const frame = buildSmpFrame(3, 1, 1, 4, { rc: 0, off: 4096 });
  const long = buildSmpFrame(3, 1, 0, 5, { data: new Uint8Array(400).fill(7) });

  it.each([
    ["a single-line frame", frame],
    ["a frame split across lines", long],
  ])("reassembles %s", (_name, sent) => {
    expect(decode(encodeSerialFrame(sent))).toEqual([sent]);
  });

  it("reassembles a frame that arrives a byte at a time", () => {
    const bytes = [...encodeSerialFrame(long)].map((b) => new Uint8Array([b]));
    expect(decode(...bytes)).toEqual([long]);
  });

  it("decodes frames back to back", () => {
    expect(decode(encodeSerialFrame(frame), encodeSerialFrame(long))).toEqual([
      frame,
      long,
    ]);
  });

  it("ignores the shell's own output around a frame", () => {
    expect(
      decode(
        ascii("[00:00:01.000] <inf> app: heartbeat\n"),
        encodeSerialFrame(frame),
        ascii("uart:~$ \n")
      )
    ).toEqual([frame]);
  });

  it("drops a frame that fails its CRC", () => {
    const encoded = encodeSerialFrame(frame);
    // Inside the base64 body, past the markers and the length prefix.
    encoded[10] = encoded[10] === 0x41 ? 0x42 : 0x41;
    expect(decode(encoded, encodeSerialFrame(long))).toEqual([long]);
  });

  it("drops a continuation with no start before it", () => {
    const [, continuation] = lines(encodeSerialFrame(long));
    expect(
      decode(new Uint8Array([...continuation, 0x0a]), encodeSerialFrame(frame))
    ).toEqual([frame]);
  });

  it("starts over when a new frame interrupts a partial one", () => {
    const [first] = lines(encodeSerialFrame(long));
    expect(decode(new Uint8Array([...first, 0x0a]), encodeSerialFrame(frame))).toEqual([
      frame,
    ]);
  });
});
