import { describe, expect, it } from "vitest";

import {
  YamlRawValue,
  formatYamlScalar,
  hasSerializableValue,
  parseConfiguredPlatforms,
  parseTopLevelComponents,
  parseYamlBoolean,
  serializeYamlValues,
} from "../../src/util/yaml-serialize.js";

// A Material Design Icon glyph (Plane-15 Private Use Area) — the value
// the font editor must round-trip as ``\U000F058F`` (device-builder#1232).
const MDI = String.fromCodePoint(0xf058f);

describe("parseTopLevelComponents", () => {
  it("collects every unindented `<key>:` line", () => {
    const yaml = ["wifi:", "  ssid: foo", "api:", "mqtt: broker"].join("\n");
    expect(parseTopLevelComponents(yaml)).toEqual(new Set(["wifi", "api", "mqtt"]));
  });

  it("ignores indented keys, dashes, and non-identifier leads", () => {
    const yaml = ["  nested: x", "- item", "123bad: y", "output:"].join("\n");
    expect(parseTopLevelComponents(yaml)).toEqual(new Set(["output"]));
  });

  it("returns an empty set for blank input", () => {
    expect(parseTopLevelComponents("")).toEqual(new Set());
  });
});

describe("parseConfiguredPlatforms", () => {
  it("pairs each domain with its configured platforms", () => {
    const yaml = [
      "time:",
      "  - platform: homeassistant",
      "    id: ha_time",
      "  - platform: sntp",
      "sensor:",
      '  - platform: "dht"',
    ].join("\n");
    expect(parseConfiguredPlatforms(yaml)).toEqual(
      new Set(["time.homeassistant", "time.sntp", "sensor.dht"])
    );
  });

  it("tolerates trailing comments and single quotes", () => {
    const yaml = ["binary_sensor:", "  - platform: 'gpio'  # comment"].join("\n");
    expect(parseConfiguredPlatforms(yaml)).toEqual(new Set(["binary_sensor.gpio"]));
  });

  it("ignores platform lines before any domain header", () => {
    expect(parseConfiguredPlatforms("  - platform: gpio")).toEqual(new Set());
  });

  it("returns an empty set for blank input", () => {
    expect(parseConfiguredPlatforms("")).toEqual(new Set());
  });
});

describe("parseYamlBoolean", () => {
  it("passes booleans through unchanged", () => {
    expect(parseYamlBoolean(true)).toBe(true);
    expect(parseYamlBoolean(false)).toBe(false);
  });

  it("recognises ESPHome truthy spellings case-insensitively", () => {
    for (const v of ["true", "True", "YES", "on", "enable", "ENABLE"]) {
      expect(parseYamlBoolean(v)).toBe(true);
    }
  });

  it("recognises ESPHome falsy spellings case-insensitively", () => {
    for (const v of ["false", "No", "OFF", "disable"]) {
      expect(parseYamlBoolean(v)).toBe(false);
    }
  });

  it("trims surrounding whitespace before matching", () => {
    expect(parseYamlBoolean(" true ")).toBe(true);
    expect(parseYamlBoolean("off\n")).toBe(false);
    expect(parseYamlBoolean("  ")).toBeNull();
  });

  it("returns null for non-boolean strings and non-strings", () => {
    expect(parseYamlBoolean("maybe")).toBeNull();
    expect(parseYamlBoolean(1)).toBeNull();
    expect(parseYamlBoolean(null)).toBeNull();
  });
});

describe("formatYamlScalar", () => {
  it("emits booleans and numbers bare", () => {
    expect(formatYamlScalar(true)).toBe("true");
    expect(formatYamlScalar(false)).toBe("false");
    expect(formatYamlScalar(42)).toBe("42");
    expect(formatYamlScalar(3.14)).toBe("3.14");
  });

  it("leaves a plain identifier unquoted", () => {
    expect(formatYamlScalar("GPIO4")).toBe("GPIO4");
    expect(formatYamlScalar("hello world")).toBe("hello world");
  });

  it("quotes strings the YAML loader would re-type", () => {
    expect(formatYamlScalar("true")).toBe('"true"');
    expect(formatYamlScalar("42")).toBe('"42"');
    expect(formatYamlScalar("3.14")).toBe('"3.14"');
    expect(formatYamlScalar("null")).toBe('"null"');
    expect(formatYamlScalar("1_000")).toBe('"1_000"');
  });

  it("keeps hand-written hex literals bare (i2c addresses)", () => {
    expect(formatYamlScalar("0x10")).toBe("0x10");
  });

  it("quotes structurally-unsafe strings and the empty string", () => {
    expect(formatYamlScalar("has: colon")).toBe('"has: colon"');
    expect(formatYamlScalar(" leading")).toBe('" leading"');
    expect(formatYamlScalar("trailing ")).toBe('"trailing "');
    expect(formatYamlScalar("-dash")).toBe('"-dash"');
    expect(formatYamlScalar("")).toBe('""');
  });

  it("escapes a Private-Use glyph with an uppercase \\U sequence", () => {
    expect(formatYamlScalar(MDI)).toBe('"\\U000F058F"');
  });
});

describe("hasSerializableValue", () => {
  it("treats empty / null / undefined as no value", () => {
    expect(hasSerializableValue("")).toBe(false);
    expect(hasSerializableValue(null)).toBe(false);
    expect(hasSerializableValue(undefined)).toBe(false);
    expect(hasSerializableValue([])).toBe(false);
  });

  it("treats a mapping whose every descendant is empty as no value", () => {
    expect(hasSerializableValue({ a: "", b: { c: null } })).toBe(false);
  });

  it("treats real scalars, lists, and raw blocks as values", () => {
    expect(hasSerializableValue(0)).toBe(true);
    expect(hasSerializableValue("x")).toBe(true);
    expect(hasSerializableValue(["a"])).toBe(true);
    expect(hasSerializableValue({ a: "x" })).toBe(true);
    expect(hasSerializableValue(new YamlRawValue(["body"], "|-"))).toBe(true);
    expect(hasSerializableValue({ _lambda: "return 1;" })).toBe(true);
  });
});

describe("serializeYamlValues — scalars and skip rules", () => {
  it("emits scalar key/value pairs", () => {
    expect(serializeYamlValues({ name: "foo", count: 5, on: true }, "")).toEqual([
      "name: foo",
      "count: 5",
      "on: true",
    ]);
  });

  it("drops null, undefined, and (by default) empty-string values", () => {
    expect(serializeYamlValues({ a: null, b: undefined, c: "", d: 1 }, "")).toEqual([
      "d: 1",
    ]);
  });

  it("keeps empty strings when keepEmptyStrings is set", () => {
    expect(serializeYamlValues({ sub: "" }, "", { keepEmptyStrings: true })).toEqual([
      'sub: ""',
    ]);
  });

  it("threads keepEmptyStrings through a nested mapping", () => {
    expect(
      serializeYamlValues({ sub: { inner: "" } }, "", { keepEmptyStrings: true })
    ).toEqual(["sub:", '  inner: ""']);
  });

  it("honours the supplied indent prefix", () => {
    expect(serializeYamlValues({ name: "foo" }, "    ")).toEqual(["    name: foo"]);
  });
});

describe("serializeYamlValues — nested mappings", () => {
  it("recurses into nested objects at one step deeper", () => {
    expect(serializeYamlValues({ wifi: { ssid: "x", password: "y" } }, "")).toEqual([
      "wifi:",
      "  ssid: x",
      "  password: y",
    ]);
  });

  it("omits a nested mapping that serialises to nothing", () => {
    expect(serializeYamlValues({ wifi: { ssid: "" } }, "")).toEqual([]);
  });

  it("uses the configured indentStep for deeper levels", () => {
    expect(
      serializeYamlValues({ wifi: { ssid: "x" } }, "", { indentStep: "    " })
    ).toEqual(["wifi:", "    ssid: x"]);
  });
});

describe("serializeYamlValues — lists", () => {
  it("emits a scalar list as block items", () => {
    expect(serializeYamlValues({ tags: ["a", "b"] }, "")).toEqual([
      "tags:",
      "  - a",
      "  - b",
    ]);
  });

  it("skips an empty list", () => {
    expect(serializeYamlValues({ tags: [] }, "")).toEqual([]);
  });

  it("emits a mapping list item with aligned follow-up keys", () => {
    expect(serializeYamlValues({ items: [{ name: "a", icon: "b" }] }, "")).toEqual([
      "items:",
      "  - name: a",
      "    icon: b",
    ]);
  });

  it("aligns follow-up keys two columns past the dash on a 4-space file", () => {
    expect(
      serializeYamlValues({ items: [{ name: "a", icon: "b" }] }, "", {
        indentStep: "    ",
      })
    ).toEqual(["items:", "    - name: a", "      icon: b"]);
  });

  it("round-trips a freshly-added empty item as a bare dash", () => {
    expect(serializeYamlValues({ list: [{}] }, "")).toEqual(["list:", "  -"]);
  });

  it("round-trips a single null-valued key as `- key:` (#941)", () => {
    expect(serializeYamlValues({ effects: [{ pulse: null }] }, "")).toEqual([
      "effects:",
      "  - pulse:",
    ]);
  });

  it("emits a scalar sub-list inside an item as a flow list (#1232)", () => {
    expect(serializeYamlValues({ extras: [{ glyphs: ["a,b", "c"] }] }, "")).toEqual([
      "extras:",
      '  - glyphs: ["a,b", c]',
    ]);
  });

  it("emits a mapping sub-list inside an item as block items", () => {
    expect(serializeYamlValues({ x: [{ sub: [{ k: "v" }] }] }, "")).toEqual([
      "x:",
      "  - sub:",
      "      - k: v",
    ]);
  });
});

describe("serializeYamlValues — raw blocks and lambdas", () => {
  it("pastes a YamlRawValue back under its inline header", () => {
    const raw = new YamlRawValue(["  return x;"], "|-");
    expect(serializeYamlValues({ lambda: raw }, "")).toEqual([
      "lambda: |-",
      "  return x;",
    ]);
  });

  it("emits an untagged lambda sentinel as a bare block scalar", () => {
    expect(serializeYamlValues({ value: { _lambda: "return 1;" } }, "")).toEqual([
      "value: |-",
      "  return 1;",
    ]);
  });

  it("emits a tagged lambda sentinel with the !lambda tag (#940)", () => {
    expect(
      serializeYamlValues({ value: { _lambda: "return 1;", _tag: "!lambda" } }, "")
    ).toEqual(["value: !lambda |-", "  return 1;"]);
  });

  it("pastes a YamlRawValue under a list-item key at the dash prefix", () => {
    const raw = new YamlRawValue(["      return x;"], "|-");
    expect(serializeYamlValues({ triggers: [{ lambda: raw }] }, "")).toEqual([
      "triggers:",
      "  - lambda: |-",
      "      return x;",
    ]);
  });

  it("emits an untagged lambda sentinel inside a list item as a bare block", () => {
    expect(
      serializeYamlValues({ triggers: [{ value: { _lambda: "return 1;" } }] }, "")
    ).toEqual(["triggers:", "  - value: |-", "      return 1;"]);
  });

  it("emits a tagged lambda sentinel inside a list item with the !lambda tag (#940)", () => {
    expect(
      serializeYamlValues(
        { triggers: [{ value: { _lambda: "return 1;", _tag: "!lambda" } }] },
        ""
      )
    ).toEqual(["triggers:", "  - value: !lambda |-", "      return 1;"]);
  });
});

describe("YamlRawValue", () => {
  it("computes the common leading-whitespace indent", () => {
    expect(new YamlRawValue(["    a", "    b"]).indent).toBe("    ");
    expect(new YamlRawValue(["  a", "    b"]).indent).toBe("  ");
    expect(new YamlRawValue([]).indent).toBe("");
    expect(new YamlRawValue(["   "]).indent).toBe("");
  });

  it("dedents the body and coerces to it via toString", () => {
    const raw = new YamlRawValue(["    return x;", "    return y;"]);
    expect(raw.body).toBe("return x;\nreturn y;");
    expect(`${raw}`).toBe("return x;\nreturn y;");
  });

  it("round-trips editor text through fromBodyText, preserving indent + header", () => {
    const original = new YamlRawValue(["  seed"], "|-");
    const rebuilt = YamlRawValue.fromBodyText("a\n\nb", original);
    expect(rebuilt.lines).toEqual(["  a", "", "  b"]);
    expect(rebuilt.inlineHeader).toBe("|-");
    expect(rebuilt.body).toBe("a\n\nb");
  });
});
