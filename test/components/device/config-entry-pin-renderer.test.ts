import { describe, expect, it } from "vitest";
import { parsePinGpio } from "../../../src/components/device/config-entry-pin-renderer.js";

describe("parsePinGpio", () => {
  it("accepts bare integers", () => {
    expect(parsePinGpio(12)).toBe(12);
    expect(parsePinGpio(0)).toBe(0);
  });

  it("accepts GPIO-prefixed strings, case-insensitively", () => {
    expect(parsePinGpio("GPIO13")).toBe(13);
    expect(parsePinGpio("gpio5")).toBe(5);
    expect(parsePinGpio("  GPIO2  ")).toBe(2);
  });

  it("accepts plain numeric strings", () => {
    expect(parsePinGpio("7")).toBe(7);
    expect(parsePinGpio("0")).toBe(0);
  });

  it("extracts the GPIO from a long-form pin block", () => {
    // The Sonoff Basic front-panel button preset locks the pin as a
    // structured ESPHome pin block (number + mode + inverted). Without
    // recognising the `number` field the dropdown rendered blank even
    // though the underlying value was correct.
    expect(
      parsePinGpio({
        number: 0,
        mode: { input: true, pullup: true },
        inverted: true,
      }),
    ).toBe(0);
    expect(parsePinGpio({ number: 13 })).toBe(13);
    expect(parsePinGpio({ number: "GPIO4" })).toBe(4);
  });

  it("returns null for unparseable values", () => {
    expect(parsePinGpio(null)).toBeNull();
    expect(parsePinGpio(undefined)).toBeNull();
    expect(parsePinGpio("")).toBeNull();
    expect(parsePinGpio("not a pin")).toBeNull();
    expect(parsePinGpio({})).toBeNull();
    expect(parsePinGpio({ number: "nope" })).toBeNull();
    expect(parsePinGpio([])).toBeNull();
    expect(parsePinGpio(Number.NaN)).toBeNull();
  });
});
