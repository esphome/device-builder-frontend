import { describe, expect, it } from "vitest";
import { expandPinModeShorthand, PIN_MODE_SHORTHANDS } from "../../src/util/pin-mode.js";

describe("expandPinModeShorthand", () => {
  it("expands every shorthand to its documented flag dict", () => {
    expect(expandPinModeShorthand("INPUT")).toEqual({ input: true });
    expect(expandPinModeShorthand("OUTPUT")).toEqual({ output: true });
    expect(expandPinModeShorthand("INPUT_PULLUP")).toEqual({
      input: true,
      pullup: true,
    });
    expect(expandPinModeShorthand("OUTPUT_OPEN_DRAIN")).toEqual({
      output: true,
      open_drain: true,
    });
    expect(expandPinModeShorthand("INPUT_PULLDOWN")).toEqual({
      input: true,
      pulldown: true,
    });
    expect(expandPinModeShorthand("INPUT_PULLDOWN_16")).toEqual({
      input: true,
      pulldown: true,
    });
    expect(expandPinModeShorthand("INPUT_OUTPUT_OPEN_DRAIN")).toEqual({
      input: true,
      output: true,
      open_drain: true,
    });
  });

  it("matches case-insensitively (ESPHome upper-cases first)", () => {
    expect(expandPinModeShorthand("output")).toEqual({ output: true });
    expect(expandPinModeShorthand("Input_Pullup")).toEqual({
      input: true,
      pullup: true,
    });
  });

  it("returns null for an unknown shorthand", () => {
    expect(expandPinModeShorthand("BOGUS")).toBeNull();
    expect(expandPinModeShorthand("")).toBeNull();
  });

  it("returns a fresh object that doesn't alias the shared table", () => {
    const a = expandPinModeShorthand("OUTPUT")!;
    a.pullup = true;
    expect(PIN_MODE_SHORTHANDS.OUTPUT).toEqual({ output: true });
    expect(expandPinModeShorthand("OUTPUT")).toEqual({ output: true });
  });
});
