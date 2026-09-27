/**
 * parseTimePeriodScalar normalizes every ESPHome time-unit alias onto a
 * canonical picker unit so a value like `1sec` splits into the widget
 * instead of blanking out.
 */
import { describe, expect, it } from "vitest";

import {
  clampTimePeriodUnit,
  durationMappingAsScalar,
  looksLikeTimePeriodScalar,
  parseTimePeriodScalar,
  serializeTimePeriod,
  TIME_PERIOD_UNITS,
  timePeriodUnitsFor,
} from "../../src/util/time-period.js";

describe("parseTimePeriodScalar", () => {
  it.each([
    ["1sec", { value: "1", unit: "s", parseable: true, unitless: false }],
    ["34.1sec", { value: "34.1", unit: "s", parseable: true, unitless: false }],
    ["1.0sec", { value: "1.0", unit: "s", parseable: true, unitless: false }],
    ["5seconds", { value: "5", unit: "s", parseable: true, unitless: false }],
    ["200ms", { value: "200", unit: "ms", parseable: true, unitless: false }],
    ["10milliseconds", { value: "10", unit: "ms", parseable: true, unitless: false }],
    ["1min", { value: "1", unit: "min", parseable: true, unitless: false }],
    ["2minutes", { value: "2", unit: "min", parseable: true, unitless: false }],
    ["3hours", { value: "3", unit: "h", parseable: true, unitless: false }],
    ["4days", { value: "4", unit: "d", parseable: true, unitless: false }],
    ["500microseconds", { value: "500", unit: "us", parseable: true, unitless: false }],
    ["1 sec", { value: "1", unit: "s", parseable: true, unitless: false }],
  ])("parses %s", (input, expected) => {
    expect(parseTimePeriodScalar(input)).toEqual(expected);
  });

  it("treats an empty value as parseable seconds", () => {
    expect(parseTimePeriodScalar("")).toEqual({
      value: "",
      unit: "s",
      parseable: true,
      unitless: false,
    });
  });

  it("surfaces a compound form as unparseable raw text", () => {
    expect(parseTimePeriodScalar("1h30s")).toEqual({
      value: "1h30s",
      unit: "s",
      parseable: false,
      unitless: false,
    });
  });

  it.each(["100", 100, "0", "2.5"])("reads a bare %j as a number with no unit", (raw) => {
    expect(parseTimePeriodScalar(raw)).toMatchObject({
      value: String(raw),
      parseable: true,
      unitless: true,
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

describe("timePeriodUnitsFor", () => {
  it.each([undefined, null, "", "ns", "us", "fortnight"])(
    "offers every unit for min unit %j",
    (minUnit) => {
      expect(timePeriodUnitsFor(minUnit)).toEqual(TIME_PERIOD_UNITS);
    }
  );

  it.each([
    ["ms", ["ms", "s", "min", "h", "d"]],
    ["s", ["s", "min", "h", "d"]],
    ["min", ["min", "h", "d"]],
  ])("offers %s and coarser", (minUnit, expected) => {
    expect(timePeriodUnitsFor(minUnit)).toEqual(expected);
  });

  it("keeps a finer unit the value already uses, in picker order", () => {
    expect(timePeriodUnitsFor("s", "us")).toEqual(["us", "s", "min", "h", "d"]);
  });

  it("adds nothing when the in-use unit is already offered", () => {
    expect(timePeriodUnitsFor("ms", "h")).toEqual(["ms", "s", "min", "h", "d"]);
  });
});

describe("durationMappingAsScalar", () => {
  it.each([
    [{ seconds: 2 }, "2s"],
    [{ milliseconds: "250" }, "250ms"],
    [{ minutes: 1.5 }, "1.5min"],
    [{ microseconds: 4 }, "4us"],
    [{ hours: 1 }, "1h"],
    [{ days: 7 }, "7d"],
  ])("reads %j", (raw, expected) => {
    expect(durationMappingAsScalar(raw)).toBe(expected);
  });

  it.each([
    ["a multi-unit mapping", { minutes: 1, seconds: 30 }],
    ["an empty mapping", {}],
    ["a non-unit key", { entity_state: "room_temp" }],
    ["a unit alias, which the mapping form does not accept", { sec: 2 }],
    ["an inherited key", { toString: 2 }],
    ["a non-numeric amount", { seconds: "soon" }],
    ["a nested amount", { seconds: { value: 2 } }],
    ["a list", [{ seconds: 2 }]],
    ["a scalar", "2s"],
    ["null", null],
  ])("is null for %s", (_label, raw) => {
    expect(durationMappingAsScalar(raw)).toBeNull();
  });
});

describe("clampTimePeriodUnit", () => {
  it.each([
    ["s", "min", "min"],
    ["us", "ms", "ms"],
    ["s", "ms", "s"],
    ["h", "min", "h"],
    ["s", undefined, "s"],
    ["us", "ns", "us"],
  ] as const)("%s on a %s-precision field is %s", (unit, minUnit, expected) => {
    expect(clampTimePeriodUnit(unit, minUnit)).toBe(expected);
  });
});
