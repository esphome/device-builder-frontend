import { describe, expect, it } from "vitest";
import { crc32 } from "../../src/util/crc32.js";

describe("crc32", () => {
  it("is zlib's CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("gives an erased sector the value bk7231tools looks for", () => {
    expect(crc32(new Uint8Array(4096).fill(0xff))).toBe(0xf154670a);
  });
});
