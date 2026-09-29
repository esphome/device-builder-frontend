import { describe, expect, it } from "vitest";
import { findOptionValue, optionShowsValue } from "../../src/util/option-match.js";

const REVISIONS = ["0.0", "1.0", "1.1", "2.0", "3.0", "3.1"];

describe("optionShowsValue", () => {
  it.each<[string, string | number]>([
    ["3.0", "3.0"],
    ["ESP32C6", "esp32c6"],
    ["3.0", 3],
    ["1.1", 1.1],
    ["1.10", 1.1],
    ["GPIO9", 9],
    ["GPIO9", "9"],
    ["P0.27", "27"],
  ])("option %s presents %s", (option, raw) => {
    expect(optionShowsValue(option, raw)).toBe(true);
  });

  it.each<[string, string | number | null | undefined]>([
    ["3.1", 3],
    ["3.0", "3"],
    ["0", ""],
    ["", 0],
    ["16", "0x10"],
    ["GPIO9", "GPIO8"],
    ["single", "quad"],
    ["3.0", null],
    ["3.0", undefined],
  ])("option %s does not present %s", (option, raw) => {
    expect(optionShowsValue(option, raw)).toBe(false);
  });
});

describe("findOptionValue", () => {
  it("lands a bare YAML decimal on the option spelled with its trailing zero", () => {
    expect(findOptionValue(3, REVISIONS)).toBe("3.0");
    expect(findOptionValue(1.1, REVISIONS)).toBe("1.1");
  });

  it("keeps a quoted numeric string to its own spelling", () => {
    expect(findOptionValue("3", REVISIONS)).toBeNull();
    expect(findOptionValue("3.0", REVISIONS)).toBe("3.0");
  });

  it("prefers the case fold over a decimal match", () => {
    expect(findOptionValue("esp32c6", ["ESP32C6", "ESP32S3"])).toBe("ESP32C6");
  });

  it("falls through to the board GPIO alias", () => {
    expect(findOptionValue("9", ["GPIO8", "GPIO9"])).toBe("GPIO9");
    expect(findOptionValue("P0.27", ["GPIO26", "GPIO27"])).toBe("GPIO27");
  });

  it("returns null for an empty value or one no option presents", () => {
    expect(findOptionValue("", REVISIONS)).toBeNull();
    expect(findOptionValue(null, REVISIONS)).toBeNull();
    expect(findOptionValue(4, REVISIONS)).toBeNull();
    expect(findOptionValue("P0.30", ["GPIO1", "GPIO2"])).toBeNull();
  });
});
