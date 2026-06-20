/**
 * Pure read/write helpers behind the Delay action's bespoke value+unit /
 * lambda widget. These run in the default node env (no DOM): the params
 * dict is the single source of truth and every helper is a pure function
 * over it, so the round-trip invariants the renderer relies on can be
 * pinned without mounting the element.
 */
import { describe, expect, it } from "vitest";

import {
  clearedDelayParams,
  delayLambdaOf,
  readDelay,
  writeDelayLambdaParams,
  writeDelayParams,
} from "../../../../src/components/device/automation-editor/automation-delay-params.js";

describe("readDelay", () => {
  it("reads a canonical unit field as value + unit", () => {
    expect(readDelay({ seconds: "5" })).toEqual({ value: "5", unit: "s" });
  });

  it("prefers the finest unit when several fields carry a value", () => {
    // DELAY_UNITS iterate least → most coarse, so ms wins over s.
    expect(readDelay({ milliseconds: "200", seconds: "5" })).toEqual({
      value: "200",
      unit: "ms",
    });
  });

  it("splits a string shorthand under id into value + unit", () => {
    expect(readDelay({ id: "2s" })).toEqual({ value: "2", unit: "s" });
  });

  it("parses an aliased shorthand (1sec) as seconds", () => {
    expect(readDelay({ id: "1sec" })).toEqual({ value: "1", unit: "s" });
  });

  it("blanks for a bare-number shortcut (ESPHome needs a unit)", () => {
    expect(readDelay({ id: "5" })).toEqual({ value: "", unit: "s" });
  });

  it("falls back to empty seconds for no fields", () => {
    expect(readDelay({})).toEqual({ value: "", unit: "s" });
  });

  it("ignores empty / null field values", () => {
    expect(readDelay({ seconds: "", minutes: null })).toEqual({
      value: "",
      unit: "s",
    });
  });
});

describe("clearedDelayParams", () => {
  it("strips every unit field and the id shorthand, keeping the rest", () => {
    expect(
      clearedDelayParams({ seconds: "5", milliseconds: "1", id: "2s", other: "keep" })
    ).toEqual({ other: "keep" });
  });

  it("does not mutate the input", () => {
    const params = { seconds: "5" };
    clearedDelayParams(params);
    expect(params).toEqual({ seconds: "5" });
  });
});

describe("writeDelayParams", () => {
  it("writes the canonical <unit> field and clears competing slots", () => {
    expect(writeDelayParams({ id: "1sec" }, "2", "s")).toEqual({ seconds: "2" });
  });

  it("trims whitespace before writing", () => {
    expect(writeDelayParams({}, "  7 ", "min")).toEqual({ minutes: "7" });
  });

  it("clears the field entirely when the value is blank", () => {
    expect(writeDelayParams({ seconds: "5" }, "   ", "s")).toEqual({});
  });
});

describe("writeDelayLambdaParams", () => {
  it("puts a tagged lambda sentinel under id and clears unit slots", () => {
    expect(writeDelayLambdaParams({ seconds: "5" }, "return 1;")).toEqual({
      id: { _lambda: "return 1;", _tag: "!lambda" },
    });
  });
});

describe("delayLambdaOf", () => {
  it("returns the sentinel for a !lambda id", () => {
    const id = { _lambda: "return 0;", _tag: "!lambda" };
    expect(delayLambdaOf({ id })).toEqual(id);
  });

  it("returns null for a plain scalar id", () => {
    expect(delayLambdaOf({ id: "2s" })).toBeNull();
  });

  it("returns null when no id is present", () => {
    expect(delayLambdaOf({ seconds: "5" })).toBeNull();
  });
});
