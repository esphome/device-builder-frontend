import { describe, expect, it } from "vitest";

import { isFlashParts, isHandoffFlasher } from "../../src/web/flash-receiver/protocol.js";

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

describe("isHandoffFlasher", () => {
  it("takes the ids this build knows and nothing inherited or foreign", () => {
    expect(isHandoffFlasher("esp")).toBe(true);
    expect(isHandoffFlasher("rtl-ambz2")).toBe(true);
    expect(isHandoffFlasher("rp2-picoboot")).toBe(true);
    expect(isHandoffFlasher("nrf-dfu")).toBe(true);
    expect(isHandoffFlasher("bk-uart")).toBe(true);
    expect(isHandoffFlasher("rtl-ambz1")).toBe(false);
    expect(isHandoffFlasher("toString")).toBe(false);
    expect(isHandoffFlasher(undefined)).toBe(false);
  });
});
