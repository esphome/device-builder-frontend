import { describe, expect, it } from "vitest";
import { resolveLogBaudRate } from "../../src/util/log-baud-rate.js";

describe("resolveLogBaudRate", () => {
  it("uses the device's configured baud", () => {
    expect(resolveLogBaudRate(19200)).toBe(19200);
  });

  it("falls back to 115200 when unset on the wire", () => {
    expect(resolveLogBaudRate(null)).toBe(115200);
    expect(resolveLogBaudRate(undefined)).toBe(115200);
  });

  it("returns null when serial logging is disabled (baud_rate 0)", () => {
    expect(resolveLogBaudRate(0)).toBeNull();
  });
});
