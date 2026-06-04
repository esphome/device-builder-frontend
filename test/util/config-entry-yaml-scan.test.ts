import { beforeEach, describe, expect, it } from "vitest";
import {
  _clearScanMemos,
  findReferencedComponents,
  findUsedPins,
} from "../../src/util/config-entry-yaml-scan.js";

// The scans use module-level single-entry memos. Within a single
// test file vitest runs cases sequentially, so cache state from
// one case can leak into the next. Reset between cases so each
// test starts cold and identity assertions don't depend on
// ordering. Production code doesn't need this — eviction-on-
// key-change is the right semantics there.
beforeEach(() => {
  _clearScanMemos();
});

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

  it("detects non-GPIOn pin forms (bk72xx, rtl87xx, ln882x, nRF52)", () => {
    // Conflict warnings must fire for LibreTiny / nRF52 configs, whose pins
    // aren't written "GPIOn": bk72xx "P{n}", port-A "PA{n}", ln882x port-B
    // "PB{n}" (16+n), nRF52 "P{port}.{pin}".
    const config = [
      "switch:",
      "  - platform: gpio",
      "    pin: P23", // bk72xx -> 23
      "light:",
      "  - platform: status_led",
      "    pin:",
      "      number: PA02", // port A -> 2
      "output:",
      "  - platform: gpio",
      "    pin: PB03", // ln882x port B -> 19
      "sensor:",
      "  - platform: gpio",
      "    pin: P1.1", // nRF52 -> 33
      "",
    ].join("\n");
    const map = findUsedPins(config);
    expect(map.get(23)).toBe("switch");
    expect(map.get(2)).toBe("light");
    expect(map.get(19)).toBe("output");
    expect(map.get(33)).toBe("sensor");
  });

  it("does not mistake P-prefixed words for bare P{n} pins", () => {
    // `\b` boundaries keep "P5" inside ordinary identifiers / words from
    // registering as a used pin — only standalone pin tokens count.
    const config = [
      "sensor:",
      "  - platform: adc",
      "    name: STEP5 PUMP7 voltage", // not pins
      "    id: relay_p9", // not a pin
      "",
    ].join("\n");
    const map = findUsedPins(config);
    expect(map.has(5)).toBe(false);
    expect(map.has(7)).toBe(false);
    expect(map.has(9)).toBe(false);
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
    // Single-entry memo: the previous yaml's cache is evicted
    // by the new yaml. A round-trip back to the original yaml
    // would re-scan, not return the original Map. A multi-entry
    // future-refactor could make round-trips identity-stable;
    // pinning the single-entry contract here ensures any such
    // change is deliberate.
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

  it("does not cache the empty-yaml early return", () => {
    // Empty input bypasses the memo write. A regression where
    // empty results were cached would silently mask a future
    // change that needed to do exclude-range work even on
    // empty input — verify a fresh empty Map is built each
    // call.
    const a = findUsedPins("");
    const b = findUsedPins("");
    expect(a).not.toBe(b);
    expect(a.size).toBe(0);
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
    // Single-entry semantics: round-trip back to the original
    // yaml re-scans, not returns the original array. Pinning
    // for the same reason as the pin memo's equivalent test.
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
