/**
 * parseTimePeriodScalar normalizes every ESPHome time-unit alias onto a
 * canonical picker unit so a value like `1sec` splits into the widget
 * instead of blanking out.
 */
import { describe, expect, it } from "vitest";

import {
  looksLikeTimePeriodScalar,
  parseTimePeriodScalar,
  serializeTimePeriod,
} from "../../src/util/time-period.js";

describe("parseTimePeriodScalar", () => {
  it.each([
    ["1sec", { value: "1", unit: "s", parseable: true }],
    ["34.1sec", { value: "34.1", unit: "s", parseable: true }],
    ["1.0sec", { value: "1.0", unit: "s", parseable: true }],
    ["5seconds", { value: "5", unit: "s", parseable: true }],
    ["200ms", { value: "200", unit: "ms", parseable: true }],
    ["10milliseconds", { value: "10", unit: "ms", parseable: true }],
    ["1min", { value: "1", unit: "min", parseable: true }],
    ["2minutes", { value: "2", unit: "min", parseable: true }],
    ["3hours", { value: "3", unit: "h", parseable: true }],
    ["4days", { value: "4", unit: "d", parseable: true }],
    ["500microseconds", { value: "500", unit: "us", parseable: true }],
    ["1 sec", { value: "1", unit: "s", parseable: true }],
    ["100", { value: "100", unit: "s", parseable: true }],
  ])("parses %s", (input, expected) => {
    expect(parseTimePeriodScalar(input)).toEqual(expected);
  });

  it("treats an empty value as parseable seconds", () => {
    expect(parseTimePeriodScalar("")).toEqual({ value: "", unit: "s", parseable: true });
  });

  it("surfaces a compound form as unparseable raw text", () => {
    expect(parseTimePeriodScalar("1h30s")).toEqual({
      value: "1h30s",
      unit: "s",
      parseable: false,
    });
  });
});

describe("looksLikeTimePeriodScalar", () => {
  it("matches aliased units", () => {
    expect(looksLikeTimePeriodScalar("1sec")).toBe(true);
    expect(looksLikeTimePeriodScalar("34.1seconds")).toBe(true);
  });

  it("rejects a bare number", () => {
    expect(looksLikeTimePeriodScalar("5")).toBe(false);
  });
});

describe("serializeTimePeriod", () => {
  it("joins value and canonical unit", () => {
    expect(serializeTimePeriod("15", "s")).toBe("15s");
  });

  it("drops an empty value", () => {
    expect(serializeTimePeriod("", "s")).toBe("");
  });
});
