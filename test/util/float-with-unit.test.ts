import { describe, expect, it } from "vitest";
import {
  parseFloatWithUnit,
  serializeFloatWithUnit,
} from "../../src/util/float-with-unit.js";

const FREQUENCY_UNITS = ["Hz", "mHz", "kHz", "MHz", "GHz"] as const;
const TEMPERATURE_UNITS = ["°C", "°F", "K"] as const;

describe("parseFloatWithUnit", () => {
  it("splits the canonical case", () => {
    expect(parseFloatWithUnit("50kHz", FREQUENCY_UNITS)).toEqual({
      value: 50,
      unit: "kHz",
    });
  });

  it("tolerates whitespace between number and unit", () => {
    expect(parseFloatWithUnit("50 kHz", FREQUENCY_UNITS)).toEqual({
      value: 50,
      unit: "kHz",
    });
  });

  it("handles non-ASCII unit characters", () => {
    expect(parseFloatWithUnit("-40°C", TEMPERATURE_UNITS)).toEqual({
      value: -40,
      unit: "°C",
    });
  });

  it("prefers the longest matching unit suffix", () => {
    // "mHz" must not lose its "m" prefix to a shorter "Hz" option.
    expect(parseFloatWithUnit("0.5mHz", FREQUENCY_UNITS)).toEqual({
      value: 0.5,
      unit: "mHz",
    });
  });

  it("falls back to the canonical unit on bare numbers", () => {
    expect(parseFloatWithUnit("50", FREQUENCY_UNITS)).toEqual({
      value: 50,
      unit: "Hz",
    });
    expect(parseFloatWithUnit(50, FREQUENCY_UNITS)).toEqual({
      value: 50,
      unit: "Hz",
    });
  });

  it("returns null value for empty input", () => {
    expect(parseFloatWithUnit("", FREQUENCY_UNITS)).toEqual({
      value: null,
      unit: "Hz",
    });
    expect(parseFloatWithUnit(null, FREQUENCY_UNITS)).toEqual({
      value: null,
      unit: "Hz",
    });
    expect(parseFloatWithUnit(undefined, FREQUENCY_UNITS)).toEqual({
      value: null,
      unit: "Hz",
    });
  });

  it("returns null value when the numeric portion is non-numeric", () => {
    expect(parseFloatWithUnit("abc kHz", FREQUENCY_UNITS)).toEqual({
      value: null,
      unit: "kHz",
    });
  });

  it("falls back to empty unit when unit_options is empty", () => {
    expect(parseFloatWithUnit("42", [])).toEqual({ value: 42, unit: "" });
  });
});

describe("serializeFloatWithUnit", () => {
  it("concatenates value and unit without separator", () => {
    expect(
      serializeFloatWithUnit({ value: 50, unit: "kHz" }),
    ).toBe("50kHz");
  });

  it("returns empty string for null value", () => {
    expect(serializeFloatWithUnit({ value: null, unit: "kHz" })).toBe("");
  });

  it("round-trips through parse", () => {
    const parsed = parseFloatWithUnit("3.3V", ["V", "mV", "kV"]);
    expect(serializeFloatWithUnit(parsed)).toBe("3.3V");
  });
});
