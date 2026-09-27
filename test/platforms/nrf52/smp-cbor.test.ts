import { describe, expect, it } from "vitest";
import { cborDecode, cborEncode } from "../../../src/platforms/nrf52/smp-cbor.js";

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const bytes = (h: string) =>
  new Uint8Array((h.match(/../g) ?? []).map((b) => parseInt(b, 16)));

describe("cborEncode", () => {
  // Vectors from RFC 8949 appendix A.
  it.each([
    [0, "00"],
    [23, "17"],
    [24, "1818"],
    [1000, "1903e8"],
    [1000000, "1a000f4240"],
    [-1, "20"],
    [-100, "3863"],
    [false, "f4"],
    [true, "f5"],
    [null, "f6"],
    ["", "60"],
    ["IETF", "6449455446"],
    [[1, 2, 3], "83010203"],
    [{ a: 1, b: [2, 3] }, "a26161016162820203"],
  ])("encodes %j", (value, expected) => {
    expect(hex(cborEncode(value))).toBe(expected);
  });

  it("encodes a byte string", () => {
    expect(hex(cborEncode(bytes("01020304")))).toBe("4401020304");
  });

  it("encodes an upload request's fields", () => {
    const encoded = cborEncode({ data: bytes("aabb"), off: 0 });
    expect(cborDecode(encoded)).toEqual({ data: bytes("aabb"), off: 0 });
  });
});

describe("cborDecode", () => {
  it.each([
    ["00", 0],
    ["1903e8", 1000],
    ["1a000f4240", 1000000],
    ["1b000000e8d4a51000", 1000000000000],
    ["3863", -100],
    ["f4", false],
    ["f5", true],
    ["f6", null],
    ["6449455446", "IETF"],
    ["83010203", [1, 2, 3]],
    ["a26161016162820203", { a: 1, b: [2, 3] }],
  ])("decodes %s", (input, expected) => {
    expect(cborDecode(bytes(input))).toEqual(expected);
  });

  it("decodes the indefinite-length map mcumgr replies with", () => {
    // {_ "rc": 0, "off": 512}
    expect(cborDecode(bytes("bf62726300636f6666190200ff"))).toEqual({ rc: 0, off: 512 });
  });

  it("decodes a 64-bit field in a map", () => {
    // {"len": 4294967296}
    expect(cborDecode(bytes("a1636c656e1b0000000100000000"))).toEqual({
      len: 4294967296,
    });
  });

  it("decodes an indefinite-length array", () => {
    expect(cborDecode(bytes("9f0102ff"))).toEqual([1, 2]);
  });

  it("copies a byte string out of the input", () => {
    const input = bytes("4401020304");
    const decoded = cborDecode(input) as Uint8Array;
    input[1] = 0xff;
    expect(hex(decoded)).toBe("01020304");
  });

  it.each(["", "19", "4401", "6449", "8301", "a16161", "fb3ff0", "fa00"])(
    "rejects the truncated input %j",
    (input) => {
      expect(() => cborDecode(bytes(input))).toThrow("CBOR: truncated input");
    }
  );
});
