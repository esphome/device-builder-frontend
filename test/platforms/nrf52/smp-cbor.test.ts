import { describe, expect, it } from "vitest";

import { cborDecode, cborEncode } from "../../../src/platforms/nrf52/smp-cbor.js";

/** Round-trip a value through encode → decode. */
function roundTrip(value: unknown): unknown {
  return cborDecode(cborEncode(value));
}

describe("cborEncode / cborDecode", () => {
  it("round-trips unsigned integers across the length boundaries", () => {
    for (const n of [0, 1, 23, 24, 255, 256, 65535, 65536, 0x01020304]) {
      expect(roundTrip(n)).toBe(n);
    }
  });

  it("round-trips booleans and null", () => {
    expect(roundTrip(true)).toBe(true);
    expect(roundTrip(false)).toBe(false);
    expect(roundTrip(null)).toBe(null);
  });

  it("round-trips text strings", () => {
    expect(roundTrip("")).toBe("");
    expect(roundTrip("off")).toBe("off");
    expect(roundTrip("a longer key with spaces")).toBe("a longer key with spaces");
  });

  it("round-trips byte strings as Uint8Array", () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    const out = roundTrip(bytes);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out as Uint8Array)).toEqual(Array.from(bytes));
  });

  it("round-trips arrays and nested maps", () => {
    expect(roundTrip([1, 2, 3])).toEqual([1, 2, 3]);
    const obj = { rc: 0, off: 1024, name: "img" };
    expect(roundTrip(obj)).toEqual(obj);
  });

  it("round-trips an image-upload payload shape", () => {
    const payload = {
      data: new Uint8Array([10, 20, 30]),
      off: 65536,
      sha: new Uint8Array(32).fill(7),
      len: 230000,
    };
    const out = roundTrip(payload) as Record<string, unknown>;
    expect(out.off).toBe(65536);
    expect(out.len).toBe(230000);
    expect(Array.from(out.data as Uint8Array)).toEqual([10, 20, 30]);
    expect(Array.from(out.sha as Uint8Array)).toEqual(Array.from(payload.sha));
  });

  // Zephyr's zcbor emits maps as indefinite-length by default (0xbf … 0xff),
  // which the decoder must handle — this was a real interop bug.
  it("decodes indefinite-length maps (0xbf … 0xff)", () => {
    // 0xbf { "rc": 0, "off": 128 } 0xff
    const bytes = new Uint8Array([
      0xbf,
      0x62,
      0x72,
      0x63,
      0x00, // "rc": 0
      0x63,
      0x6f,
      0x66,
      0x66,
      0x18,
      0x80, // "off": 128
      0xff,
    ]);
    expect(cborDecode(bytes)).toEqual({ rc: 0, off: 128 });
  });

  it("decodes indefinite-length arrays (0x9f … 0xff)", () => {
    // 0x9f [1, 2, 3] 0xff
    const bytes = new Uint8Array([0x9f, 0x01, 0x02, 0x03, 0xff]);
    expect(cborDecode(bytes)).toEqual([1, 2, 3]);
  });

  // The device can encode the offset as an 8-byte uint64 (major 0, info 27).
  it("decodes 8-byte uint64 integers", () => {
    // 0x1b 00 00 00 00 00 01 00 00 = 65536
    const bytes = new Uint8Array([0x1b, 0, 0, 0, 0, 0, 1, 0, 0]);
    expect(cborDecode(bytes)).toBe(65536);
  });

  it("decodes a uint64-valued map field", () => {
    // 0xbf "off": (uint64) 300000 0xff
    const off = 300000;
    const hi = Math.floor(off / 0x100000000);
    const lo = off >>> 0;
    const bytes = new Uint8Array([
      0xbf,
      0x63,
      0x6f,
      0x66,
      0x66, // "off"
      0x1b,
      (hi >>> 24) & 0xff,
      (hi >>> 16) & 0xff,
      (hi >>> 8) & 0xff,
      hi & 0xff,
      (lo >>> 24) & 0xff,
      (lo >>> 16) & 0xff,
      (lo >>> 8) & 0xff,
      lo & 0xff,
      0xff,
    ]);
    expect(cborDecode(bytes)).toEqual({ off: 300000 });
  });
});
