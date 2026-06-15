import { describe, expect, it } from "vitest";
import { arrayBufferToBase64 } from "../../src/util/base64.js";

/** Encode a JS string's bytes (latin1) and round-trip it back through atob. */
function bytesOf(values: number[]): ArrayBuffer {
  return Uint8Array.from(values).buffer;
}

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

describe("arrayBufferToBase64", () => {
  it("encodes a short buffer to a known base64 vector", () => {
    // "foo" => "Zm9v"
    expect(arrayBufferToBase64(bytesOf([0x66, 0x6f, 0x6f]))).toBe("Zm9v");
  });

  it("returns an empty string for an empty buffer", () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
  });

  it("handles the full 0-255 byte range without corruption", () => {
    const all = Array.from({ length: 256 }, (_, i) => i);
    const out = decode(arrayBufferToBase64(bytesOf(all)));
    expect(Array.from(out)).toEqual(all);
  });

  it("round-trips a buffer that spans the 0x8000 chunk boundary", () => {
    // One full chunk plus a few bytes exercises the chunked join: the join
    // must reassemble pieces in order, not corrupt the seam.
    const size = 0x8000 + 5;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
    const out = decode(arrayBufferToBase64(bytes.buffer));
    expect(out.length).toBe(size);
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it("round-trips a buffer that is an exact multiple of the chunk size", () => {
    const size = 0x8000 * 2;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 13) & 0xff;
    const out = decode(arrayBufferToBase64(bytes.buffer));
    expect(out.length).toBe(size);
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });
});
