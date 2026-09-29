import { describe, expect, it } from "vitest";
import { findOptionValue } from "../../src/util/option-match.js";

const REVISIONS = ["0.0", "1.0", "1.1", "2.0", "3.0", "3.1"];

describe("findOptionValue", () => {
  it("lands a bare YAML decimal on the option spelled with its trailing zero", () => {
    expect(findOptionValue(3, REVISIONS)).toBe("3.0");
    expect(findOptionValue(1.1, REVISIONS)).toBe("1.1");
  });

  it("keeps a quoted numeric string to its own spelling", () => {
    expect(findOptionValue("3", REVISIONS)).toBeNull();
    expect(findOptionValue("3.0", REVISIONS)).toBe("3.0");
  });

  it("prefers the exact spelling, then a case fold", () => {
    expect(findOptionValue("ESP32", ["esp32", "ESP32"])).toBe("ESP32");
    expect(findOptionValue("esp32c6", ["ESP32C6", "ESP32S3"])).toBe("ESP32C6");
  });

  it("does not read a pin alias, a leading zero, or hex as a listed spelling", () => {
    expect(findOptionValue("9", ["GPIO8", "GPIO9"])).toBeNull();
    expect(findOptionValue("GPIO1", ["1", "2"])).toBeNull();
    expect(findOptionValue("01", ["1", "2"])).toBeNull();
    expect(findOptionValue("0x10", ["16"])).toBeNull();
  });

  it("returns null for an empty, missing, non-primitive, or unlisted value", () => {
    expect(findOptionValue("", REVISIONS)).toBeNull();
    expect(findOptionValue(null, REVISIONS)).toBeNull();
    expect(findOptionValue(undefined, REVISIONS)).toBeNull();
    expect(findOptionValue({ number: 3 }, REVISIONS)).toBeNull();
    expect(findOptionValue(["3.0"], REVISIONS)).toBeNull();
    expect(findOptionValue(4, REVISIONS)).toBeNull();
  });
});
