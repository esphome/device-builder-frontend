import { describe, expect, it } from "vitest";

import { isFlashParts } from "../../src/web/flash-receiver/protocol.js";

const part = (address = 0, bytes = 8) => ({ address, data: new ArrayBuffer(bytes) });

describe("isFlashParts", () => {
  it("accepts a plausible parts array", () => {
    expect(isFlashParts([part(0), part(0x1000)])).toBe(true);
  });

  it("rejects a non-array / empty array", () => {
    expect(isFlashParts(null)).toBe(false);
    expect(isFlashParts([])).toBe(false);
  });

  it("rejects a part whose data isn't an ArrayBuffer", () => {
    expect(isFlashParts([{ address: 0, data: "nope" }])).toBe(false);
  });

  it("rejects negative, non-integer, or out-of-range addresses", () => {
    expect(isFlashParts([{ address: -1, data: new ArrayBuffer(8) }])).toBe(false);
    expect(isFlashParts([{ address: 1.5, data: new ArrayBuffer(8) }])).toBe(false);
    expect(isFlashParts([{ address: 0x1_0000_0000, data: new ArrayBuffer(8) }])).toBe(
      false
    );
  });

  it("rejects too many parts", () => {
    expect(isFlashParts(Array.from({ length: 65 }, () => part()))).toBe(false);
  });

  it("rejects an oversized single part", () => {
    expect(isFlashParts([part(0, 64 * 1024 * 1024 + 1)])).toBe(false);
  });

  it("rejects when the parts total exceeds the cap", () => {
    // Two 40 MiB parts → 80 MiB total, over the 64 MiB ceiling.
    const big = 40 * 1024 * 1024;
    expect(isFlashParts([part(0, big), part(0x1000, big)])).toBe(false);
  });
});
