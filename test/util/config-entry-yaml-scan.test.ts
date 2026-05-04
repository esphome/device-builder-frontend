import { describe, expect, it } from "vitest";
import {
  findReferencedComponents,
  findUsedPins,
} from "../../src/util/config-entry-yaml-scan.js";

describe("findUsedPins", () => {
  const yaml = [
    "switch:",
    "  - platform: gpio",
    "    pin: GPIO4",
    "binary_sensor:",
    "  - platform: gpio",
    "    pin: GPIO5",
    "",
  ].join("\n");

  it("maps each GPIO reference to its top-level domain", () => {
    const map = findUsedPins(yaml);
    expect(map.get(4)).toBe("switch");
    expect(map.get(5)).toBe("binary_sensor");
  });

  it("excludes lines in the inclusive range", () => {
    // Skip lines 4-6 (the binary_sensor block) — pin 5 should
    // not appear.
    const map = findUsedPins(yaml, 4, 6);
    expect(map.get(4)).toBe("switch");
    expect(map.has(5)).toBe(false);
  });

  it("returns an empty map for empty yaml", () => {
    expect(findUsedPins("").size).toBe(0);
  });

  it("returns the same Map reference on repeated calls (memoised)", () => {
    // Pin the cache contract: a re-render that hands us the
    // same yaml + exclude pair returns the cached Map without
    // re-scanning. A regression that drops the memo would
    // produce a fresh Map (different identity) each call.
    const a = findUsedPins(yaml);
    const b = findUsedPins(yaml);
    expect(a).toBe(b);
  });

  it("invalidates the memo when yaml changes", () => {
    const a = findUsedPins(yaml);
    const otherYaml = "switch:\n  - platform: gpio\n    pin: GPIO9\n";
    const b = findUsedPins(otherYaml);
    expect(a).not.toBe(b);
    expect(b.get(9)).toBe("switch");
  });

  it("invalidates the memo when exclude range changes", () => {
    const a = findUsedPins(yaml);
    const b = findUsedPins(yaml, 4, 6);
    expect(a).not.toBe(b);
  });
});

describe("findReferencedComponents", () => {
  const yaml = [
    "i2c:",
    "  - id: bus_a",
    "    sda: GPIO4",
    "  - id: bus_b",
    "    sda: GPIO5",
    "",
  ].join("\n");

  it("returns id/name pairs for the given domain", () => {
    expect(findReferencedComponents(yaml, "i2c")).toEqual([
      { id: "bus_a", name: "" },
      { id: "bus_b", name: "" },
    ]);
  });

  it("returns an empty array for an unknown domain", () => {
    expect(findReferencedComponents(yaml, "uart")).toEqual([]);
  });

  it("returns an empty array for an empty domain string", () => {
    expect(findReferencedComponents(yaml, "")).toEqual([]);
  });

  it("returns the same array reference on repeated calls (memoised)", () => {
    const a = findReferencedComponents(yaml, "i2c");
    const b = findReferencedComponents(yaml, "i2c");
    expect(a).toBe(b);
  });

  it("invalidates the memo when yaml changes", () => {
    const a = findReferencedComponents(yaml, "i2c");
    const otherYaml = "i2c:\n  - id: bus_z\n";
    const b = findReferencedComponents(otherYaml, "i2c");
    expect(a).not.toBe(b);
    expect(b).toEqual([{ id: "bus_z", name: "" }]);
  });

  it("invalidates the memo when domain changes", () => {
    const a = findReferencedComponents(yaml, "i2c");
    const b = findReferencedComponents(yaml, "uart");
    expect(a).not.toBe(b);
  });
});
