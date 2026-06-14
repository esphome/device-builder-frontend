import { beforeEach, describe, expect, it } from "vitest";
import {
  _clearScanMemos,
  findComponentsByProviders,
  findReferenceCandidates,
  findUsedPins,
  yamlHasMergedSources,
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

  it("ignores pin-shaped tokens in free-text key values", () => {
    // `name`/`comment` values are prose. `scanPinGpios` is value-context-
    // agnostic, so a punctuation-bounded "P0.5" / "PA02" there would read as
    // a pin (the `\b` guard only stops word-internal forms like STEP5). These
    // must not register as used pins or they raise phantom conflict warnings.
    const config = [
      "switch:",
      "  - platform: gpio",
      "    name: Pump P0.5 valve", // P0.5 -> would be pin 5
      "    comment: relay PB3 driver", // PB3 -> would be pin 19
      "    friendly_name: header PA02", // PA02 -> would be pin 2
      "    pin: GPIO7", // the only real pin
      "",
    ].join("\n");
    const map = findUsedPins(config);
    expect(map.get(7)).toBe("switch");
    expect(map.has(5)).toBe(false);
    expect(map.has(19)).toBe(false);
    expect(map.has(2)).toBe(false);
  });

  it("ignores pin-shaped tokens in inline and full-line comments", () => {
    // A `#` comment is prose too. A trailing `# was P5` or a standalone
    // `# spare PA02` line must not contribute used pins.
    const config = [
      "switch:",
      "  - platform: gpio",
      "    pin: GPIO4 # was P5 before rewire", // only GPIO4 counts
      "    # spare PA02 header", // comment-only line, no pin
      "",
    ].join("\n");
    const map = findUsedPins(config);
    expect(map.get(4)).toBe("switch");
    expect(map.has(5)).toBe(false);
    expect(map.has(2)).toBe(false);
  });

  it("still detects a real pin on a line that also carries a comment", () => {
    // Stripping the comment must not drop the pin before it.
    const config = ["switch:", "  - platform: gpio", "    pin: P23 # bk72xx", ""].join(
      "\n"
    );
    const map = findUsedPins(config);
    expect(map.get(23)).toBe("switch");
  });

  it("ignores pin-shaped tokens in multi-line block-scalar free-text values", () => {
    // A `comment: |` / `comment: >` block scalar carries prose on its
    // more-indented continuation lines. Those tokens are part of the same
    // false-positive class as single-line free-text values and must not
    // register as used pins. A real pin on the next sibling key (back at the
    // mapping indent) still counts, so the skip ends at the block's end.
    const config = [
      "switch:",
      "  - platform: gpio",
      "    comment: |",
      "      wired to P0.5 originally", // P0.5 -> would be pin 5
      "      then moved, see PA02 note", // PA02 -> would be pin 2
      "",
      "    pin: GPIO7", // real pin, after the block scalar
      "",
    ].join("\n");
    const map = findUsedPins(config);
    expect(map.get(7)).toBe("switch");
    expect(map.has(5)).toBe(false);
    expect(map.has(2)).toBe(false);
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

describe("findReferenceCandidates (same-domain base case)", () => {
  const yaml = [
    "i2c:",
    "  - id: bus_a",
    "    sda: GPIO4",
    "  - id: bus_b",
    "    sda: GPIO5",
    "",
  ].join("\n");

  it("returns id/name pairs for the reference's own domain", () => {
    expect(findReferenceCandidates(yaml, "i2c", [])).toEqual([
      { id: "bus_a", name: "" },
      { id: "bus_b", name: "" },
    ]);
  });

  it("returns an empty array for an unknown domain", () => {
    expect(findReferenceCandidates(yaml, "uart", [])).toEqual([]);
  });

  it("returns an empty array for an empty domain string", () => {
    expect(findReferenceCandidates(yaml, "", [])).toEqual([]);
  });

  it("unions the own-domain ids with cross-domain providers", () => {
    const config = [yaml, "sensor:", "  - platform: adc", "    id: adc_a", ""].join("\n");
    expect(
      findReferenceCandidates(config, "i2c", [{ domain: "sensor", stem: "adc" }])
    ).toEqual([
      { id: "bus_a", name: "" },
      { id: "bus_b", name: "" },
      { id: "adc_a", name: "" },
    ]);
  });
});

describe("findComponentsByProviders", () => {
  const yaml = [
    "sensor:",
    "  - platform: adc",
    "    id: adc_a",
    "    pin: GPIO34",
    "  - platform: dht",
    "    id: temp_a",
    "  - platform: ads1115",
    "    id: adc_b",
    "ble_nus:",
    "  id: nus_link",
    "",
  ].join("\n");

  it("matches list items by provider platform", () => {
    const providers = [
      { domain: "sensor", stem: "adc" },
      { domain: "sensor", stem: "ads1115" },
    ];
    expect(findComponentsByProviders(yaml, providers)).toEqual([
      { id: "adc_a", name: "" },
      { id: "adc_b", name: "" },
    ]);
  });

  it("matches a platform value carrying a trailing inline comment", () => {
    const commented = [
      "sensor:",
      "  - platform: adc  # current clamp",
      "    id: adc_c",
      "",
    ].join("\n");
    expect(
      findComponentsByProviders(commented, [{ domain: "sensor", stem: "adc" }])
    ).toEqual([{ id: "adc_c", name: "" }]);
  });

  it("keeps the item across a nested list (filters) before its id/name", () => {
    // A nested `filters:` list must not end the component scan — the
    // platform/id/name still belong to the outer sensor item.
    const nested = [
      "sensor:",
      "  - platform: adc",
      "    filters:",
      "      - offset: 0.1",
      "      - multiply: 2.0",
      "    id: adc_nested",
      '    name: "Nested ADC"',
      "",
    ].join("\n");
    expect(
      findComponentsByProviders(nested, [{ domain: "sensor", stem: "adc" }])
    ).toEqual([{ id: "adc_nested", name: "Nested ADC" }]);
  });

  it("excludes platforms that do not provide the interface", () => {
    const ids = findComponentsByProviders(yaml, [{ domain: "sensor", stem: "adc" }]).map(
      (c) => c.id
    );
    expect(ids).toEqual(["adc_a"]);
    expect(ids).not.toContain("temp_a");
  });

  it("an empty stem matches every id in the block (top-level provider)", () => {
    expect(findComponentsByProviders(yaml, [{ domain: "ble_nus", stem: "" }])).toEqual([
      { id: "nus_link", name: "" },
    ]);
  });

  it("returns an empty array when no providers are given", () => {
    expect(findComponentsByProviders(yaml, [])).toEqual([]);
  });

  it("memoises on (yaml, providers) and invalidates on change", () => {
    const providers = [{ domain: "sensor", stem: "adc" }];
    expect(findComponentsByProviders(yaml, providers)).toBe(
      findComponentsByProviders(yaml, providers)
    );
    const other = findComponentsByProviders(yaml, [
      { domain: "sensor", stem: "ads1115" },
    ]);
    expect(other).toEqual([{ id: "adc_b", name: "" }]);
  });
});

describe("yamlHasMergedSources", () => {
  it("is true for a top-level packages: block", () => {
    expect(yamlHasMergedSources("packages:\n  base: !include base.yaml\n")).toBe(true);
  });

  it("is true for a top-level <<: merge key", () => {
    expect(yamlHasMergedSources("<<: !include common.yaml\nesphome:\n")).toBe(true);
  });

  it("is false for a value-position !include", () => {
    expect(yamlHasMergedSources("wifi: !include wifi.yaml\n")).toBe(false);
  });

  it("is false for an indented packages-like token inside another block", () => {
    expect(yamlHasMergedSources("sensor:\n  - packages: not-a-merge\n")).toBe(false);
  });

  it("is false for plain YAML and empty input", () => {
    expect(yamlHasMergedSources("ld2410:\n  id: radar\n")).toBe(false);
    expect(yamlHasMergedSources("")).toBe(false);
  });
});
