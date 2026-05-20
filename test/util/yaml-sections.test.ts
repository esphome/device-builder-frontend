import { beforeEach, describe, expect, it } from "vitest";
import { parseYamlSectionValues } from "../../src/util/yaml-section-values.js";
import {
  _clearYamlSectionsMemo,
  categorizeSections,
  parseYamlAutomations,
  parseYamlTopLevelSections,
  resolveCurrentFromLine,
  sectionAtLine,
  type YamlSection,
} from "../../src/util/yaml-sections.js";

beforeEach(() => {
  // Single-entry memo on `parseYamlTopLevelSections` would otherwise
  // leak cached results between tests that happen to share `yaml`
  // values across unrelated cases.
  _clearYamlSectionsMemo();
});

describe("parseYamlTopLevelSections", () => {
  it("returns empty for empty input", () => {
    expect(parseYamlTopLevelSections("")).toEqual([]);
  });

  it("parses simple top-level keys", () => {
    const yaml = `esphome:
  name: test
wifi:
  ssid: "x"
`;
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections.map((s) => s.key)).toEqual(["esphome", "wifi"]);
    expect(sections[0].fromLine).toBe(1);
    expect(sections[1].fromLine).toBe(3);
  });

  it("expands list items with platform metadata", () => {
    const yaml = `sensor:
  - platform: dht
    name: "kitchen"
  - platform: bme280
    name: "bedroom"
`;
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections).toHaveLength(2);
    expect(sections[0].key).toBe("sensor");
    expect(sections[0].platform).toBe("dht");
    expect(sections[0].name).toBe("kitchen");
    expect(sections[0].parentKey).toBe("sensor");
    expect(sections[1].platform).toBe("bme280");
    expect(sections[1].name).toBe("bedroom");
  });

  it("trims trailing blank lines from the final section", () => {
    const yaml = `esphome:
  name: test

`;
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections).toHaveLength(1);
    expect(sections[0].toLine).toBeLessThanOrEqual(3);
  });

  it("does not include a comment block decorating the next section", () => {
    // Real-world repro: a user's YAML uses banner comments to label
    // each block. Hovering ``substitutions`` in the navigator was
    // highlighting the ``## Board Configuration ##`` block that
    // visually documents ``esphome:`` (the *next* section) — those
    // lines belong to neither section's content.
    //
    //  1 substitutions:
    //  2   device_friendly_name: WIFI Switch
    //  3 ## ----------- ##
    //  4 ## Board Config ##
    //  5 ## ----------- ##
    //  6 esphome:
    //  7   name: x
    const yaml = [
      "substitutions:",
      "  device_friendly_name: WIFI Switch",
      "## ----------- ##",
      "## Board Config ##",
      "## ----------- ##",
      "esphome:",
      "  name: x",
      "",
    ].join("\n");
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections.map((s) => s.key)).toEqual(["substitutions", "esphome"]);
    expect(sections[0].toLine).toBe(2);
    expect(sections[1].fromLine).toBe(6);
  });

  it("trims trailing comment-only lines from the final section too", () => {
    // The same trim has to fire for the file's last section, not
    // just the inter-section seams — a banner at EOF would otherwise
    // extend the last section's highlight range past its content.
    const yaml = [
      "esphome:",
      "  name: x",
      "## --- end of file --- ##",
      "",
    ].join("\n");
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections).toHaveLength(1);
    expect(sections[0].toLine).toBe(2);
  });

  it("keeps indented trailing comments as part of the section", () => {
    // An indented comment after a section's last setting is content
    // for that section (`# password via secrets` documenting the
    // wifi block); only top-level banner comments decorate the
    // *next* section. Without this distinction the trim would chop
    // the explanatory comment off `wifi:` and the navigator would
    // mis-locate the user-visible content.
    const yaml = [
      "wifi:",
      "  ssid: x",
      "  # password set via secrets",
      "esphome:",
      "  name: y",
      "",
    ].join("\n");
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections.map((s) => s.toLine)).toEqual([3, 5]);
  });

  it("keeps indented trailing comments as part of the final section", () => {
    const yaml = [
      "wifi:",
      "  ssid: x",
      "  # last note",
      "",
    ].join("\n");
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections).toHaveLength(1);
    expect(sections[0].toLine).toBe(3);
  });

  it("preserves blank lines that fall mid-section", () => {
    // Defensive: an internal blank or comment line shouldn't be
    // mistaken for trailing decoration. Only blank/comment runs
    // immediately preceding the next section / EOF get dropped.
    const yaml = [
      "esphome:",
      "  name: x",
      "",
      "  # internal comment",
      "  platform: ESP32",
      "wifi:",
      "  ssid: y",
      "",
    ].join("\n");
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections.map((s) => s.toLine)).toEqual([5, 7]);
  });

  it("does not treat indented keys as top-level sections", () => {
    const yaml = `esphome:
  name: test
  platform: ESP32
`;
    expect(parseYamlTopLevelSections(yaml).map((s) => s.key)).toEqual(["esphome"]);
  });

  it("keeps non-list sections as a single entry", () => {
    const yaml = `wifi:
  ssid: foo
  password: bar
`;
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections).toHaveLength(1);
    expect(sections[0].parentKey).toBeUndefined();
  });

  it("returns the same array instance for repeated calls (memo)", () => {
    // Cursor / hover dispatch hits this on every line transition;
    // the memo turns those calls into pointer-equality fast-path
    // hits when `_yaml` hasn't changed. Reference equality is the
    // observable contract of the cache.
    const yaml = `esphome:
  name: test
wifi:
  ssid: x
`;
    const a = parseYamlTopLevelSections(yaml);
    const b = parseYamlTopLevelSections(yaml);
    expect(a).toBe(b);
  });

  it("re-parses when content changes (memo invalidates)", () => {
    const yaml1 = `esphome:\n  name: test\n`;
    const yaml2 = `esphome:\n  name: other\nwifi:\n  ssid: x\n`;
    const a = parseYamlTopLevelSections(yaml1);
    const b = parseYamlTopLevelSections(yaml2);
    expect(a).not.toBe(b);
    expect(a.map((s) => s.key)).toEqual(["esphome"]);
    expect(b.map((s) => s.key)).toEqual(["esphome", "wifi"]);
  });
});

describe("sectionAtLine", () => {
  // Multi-section YAML with both a flat dict and an expanded list
  // — covers parent-line, list-item, gap, and EOF cases.
  const yaml = `# header banner
esphome:
  name: test
  comment: stays

logger:
  level: INFO

sensor:
  - platform: dht
    name: kitchen
    pin: D1
  - platform: bme280
    name: bedroom
`;
  // Line numbers (1-indexed):
  //   1: # header banner       — gap before first section
  //   2: esphome:               — esphome [2..4]
  //   3:   name: test
  //   4:   comment: stays
  //   5: (blank)                — gap (trimmed off esphome)
  //   6: logger:                — logger [6..7]
  //   7:   level: INFO
  //   8: (blank)                — gap
  //   9: sensor:                — covered by list-item ranges (no parent)
  //  10:   - platform: dht      — sensor.dht [10..12]
  //  11:     name: kitchen
  //  12:     pin: D1
  //  13:   - platform: bme280   — sensor.bme280 [13..14]
  //  14:     name: bedroom

  it("returns the section that owns the line", () => {
    expect(sectionAtLine(yaml, 3)?.key).toBe("esphome");
    expect(sectionAtLine(yaml, 7)?.key).toBe("logger");
  });

  it("hits the parent line of a flat-dict section", () => {
    expect(sectionAtLine(yaml, 2)?.key).toBe("esphome");
  });

  it("attributes a list-item dash line to that item", () => {
    const m = sectionAtLine(yaml, 10);
    expect(m?.key).toBe("sensor");
    expect(m?.platform).toBe("dht");
  });

  it("attributes content lines under a list item to the same item", () => {
    const m = sectionAtLine(yaml, 11);
    expect(m?.platform).toBe("dht");
  });

  it("crosses to the next list item", () => {
    const m = sectionAtLine(yaml, 13);
    expect(m?.platform).toBe("bme280");
  });

  it("returns null for the file header above the first section", () => {
    expect(sectionAtLine(yaml, 1)).toBeNull();
  });

  it("returns null for a blank-line gap between sections", () => {
    expect(sectionAtLine(yaml, 5)).toBeNull();
  });

  it("returns null for a line past EOF", () => {
    expect(sectionAtLine(yaml, 9999)).toBeNull();
  });

  it("returns null on empty yaml", () => {
    expect(sectionAtLine("", 1)).toBeNull();
  });

  // Cursor inside an inline automation block (``on_press:`` nested
  // under a ``binary_sensor`` list item) now resolves to the
  // automation entry, not the enclosing component — the helper
  // prefers the most-specific (smallest containing range) match so
  // the YAML pane's cursor-follow lands on the same section the
  // navigator routes to.
  it("routes inline automation lines to the automation entry, not the component", () => {
    const yaml = `binary_sensor:
  - platform: gpio
    id: door_sensor
    name: door
    pin: D2
    on_press:
      then:
        - logger.log: pressed
`;
    // ``on_press:`` itself is line 6; its body is lines 7-8.
    const m = sectionAtLine(yaml, 7);
    expect(m?.key).toBe(
      "automation:component_on:door_sensor:on_press",
    );
  });

  // Click inside a top-level ``script:`` entry resolves to that
  // entry's automation key, not the bare ``script:`` block.
  it("routes a click inside a script entry to the script automation key", () => {
    const yaml = `esphome:
  name: dev
script:
  - id: my_routine
    mode: single
    then:
      - logger.log: hello
`;
    // ``- id: my_routine`` is line 4; the ``then:`` body lives on 6-7.
    const m = sectionAtLine(yaml, 6);
    expect(m?.key).toBe("automation:script:my_routine");
  });
});

describe("categorizeSections", () => {
  const mk = (key: string): YamlSection => ({ key, fromLine: 1, toLine: 1 });

  it("puts esphome/logger/wifi into core", () => {
    const { core, components, automations } = categorizeSections([
      mk("esphome"),
      mk("logger"),
      mk("wifi"),
    ]);
    expect(core.map((s) => s.key)).toEqual(["esphome", "logger", "wifi"]);
    expect(components).toEqual([]);
    expect(automations).toEqual([]);
  });

  it("puts script/interval into automations and globals into core", () => {
    const { core, automations } = categorizeSections([
      mk("script"),
      mk("interval"),
      mk("globals"),
    ]);
    expect(automations.map((s) => s.key)).toEqual(["script", "interval"]);
    expect(core.map((s) => s.key)).toEqual(["globals"]);
  });

  it("routes unknown keys to components", () => {
    const { components } = categorizeSections([mk("sensor"), mk("switch")]);
    expect(components.map((s) => s.key)).toEqual(["sensor", "switch"]);
  });

  it("splits a mixed list across all three buckets", () => {
    const result = categorizeSections([mk("esphome"), mk("sensor"), mk("script")]);
    expect(result.core.map((s) => s.key)).toEqual(["esphome"]);
    expect(result.components.map((s) => s.key)).toEqual(["sensor"]);
    expect(result.automations.map((s) => s.key)).toEqual(["script"]);
  });
});

describe("parseYamlAutomations", () => {
  it("returns empty when there are no on_* handlers", () => {
    const yaml = `esphome:\n  name: test\n`;
    expect(parseYamlAutomations(yaml)).toEqual([]);
  });

  it("emits a stable component_on key for inline on_* handlers", () => {
    const yaml = `binary_sensor:
  - platform: gpio
    id: my_button
    name: "My Button"
    on_press:
      - logger.log: "pressed"
`;
    const result = parseYamlAutomations(yaml);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("automation:component_on:my_button:on_press");
    expect(result[0].displayLabel).toBe("My Button → on_press");
  });

  it("handles multiple handlers on the same component", () => {
    const yaml = `switch:
  - platform: gpio
    id: my_relay
    name: "Light"
    on_turn_on:
      - logger.log: "on"
    on_turn_off:
      - logger.log: "off"
`;
    const result = parseYamlAutomations(yaml);
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("automation:component_on:my_relay:on_turn_on");
    expect(result[0].displayLabel).toBe("Light → on_turn_on");
    expect(result[1].key).toBe("automation:component_on:my_relay:on_turn_off");
    expect(result[1].displayLabel).toBe("Light → on_turn_off");
  });

  it("recognises device-level on_* handlers under esphome:", () => {
    const yaml = `esphome:
  on_boot:
    - logger.log: "boot"
`;
    const [entry] = parseYamlAutomations(yaml);
    expect(entry.key).toBe("automation:device_on:on_boot");
    expect(entry.displayLabel).toBe("esphome → on_boot");
  });

  it("enumerates top-level script: list items by their id", () => {
    const yaml = `script:
  - id: my_alarm
    then:
      - logger.log: "alarm"
  - id: cleanup
    then:
      - logger.log: "cleanup"
`;
    const items = parseYamlAutomations(yaml).filter((s) =>
      s.key.startsWith("automation:script:"),
    );
    expect(items.map((s) => s.key)).toEqual([
      "automation:script:my_alarm",
      "automation:script:cleanup",
    ]);
    expect(items[0].displayLabel).toBe("script: my_alarm");
  });

  it("enumerates top-level interval: list items by index", () => {
    const yaml = `interval:
  - interval: 60s
    then:
      - logger.log: "tick"
  - interval: 5s
    then:
      - logger.log: "fast"
`;
    const items = parseYamlAutomations(yaml).filter((s) =>
      s.key.startsWith("automation:interval:"),
    );
    expect(items.map((s) => s.key)).toEqual([
      "automation:interval:0",
      "automation:interval:1",
    ]);
    expect(items[0].displayLabel).toBe("interval #1");
  });

  it("enumerates api.actions: list items by action name", () => {
    const yaml = `api:
  actions:
    - action: start_laundry
      then:
        - logger.log: "starting"
    - action: stop_laundry
      then:
        - logger.log: "stopping"
`;
    const items = parseYamlAutomations(yaml).filter((s) =>
      s.key.startsWith("automation:api_action:"),
    );
    expect(items.map((s) => s.key)).toEqual([
      "automation:api_action:start_laundry",
      "automation:api_action:stop_laundry",
    ]);
    expect(items[0].displayLabel).toBe("API: start_laundry");
    expect(items[0].parentKey).toBe("api");
  });

  it("accepts the legacy service: discriminator on api.actions:", () => {
    const yaml = `api:
  actions:
    - service: legacy_name
      then:
        - logger.log: "old"
`;
    const items = parseYamlAutomations(yaml).filter((s) =>
      s.key.startsWith("automation:api_action:"),
    );
    expect(items.map((s) => s.key)).toEqual([
      "automation:api_action:legacy_name",
    ]);
  });
});

describe("resolveCurrentFromLine", () => {
  // Pinned the section editor's stale-fromLine resolution, the
  // root cause of the wrong-section-deleted bug fixed in this
  // PR. The navigator emits `fromLine` at click time; subsequent
  // YAML mutations (paste, external edit) shift line positions.
  // The resolver re-finds the section by key against the current
  // YAML so save / delete operate on the right line.

  const otaWithBoth = [
    "ota:",
    "  - platform: esphome",
    "    password: foo",
    "  - platform: web_server",
    "",
  ].join("\n");

  it("returns the matching section's current line for a top-level key", () => {
    const yaml = "esphome:\n  name: x\nwifi:\n  ssid: y\n";
    expect(resolveCurrentFromLine(yaml, "esphome")).toBe(1);
    expect(resolveCurrentFromLine(yaml, "wifi")).toBe(3);
  });

  it("returns the platform-qualified list-item dash line", () => {
    expect(resolveCurrentFromLine(otaWithBoth, "ota.esphome")).toBe(2);
    expect(resolveCurrentFromLine(otaWithBoth, "ota.web_server")).toBe(4);
  });

  it("re-finds the section after the YAML shifts above it", () => {
    // Repro of the bug-report shape. The navigator's last-known
    // `fromLine` for `wifi:` was 3 (in a small YAML); the user
    // pasted bigger YAML that pushed `wifi:` down to line 7.
    // Stale `fromLine` = 3 would point at the WRONG section
    // ("logger:" in the new layout) — the resolver finds wifi
    // at its current line.
    const after = [
      "esphome:",
      "  name: x",
      "logger:",
      "api:",
      "  encryption:",
      "    key: \"...\"",
      "wifi:",
      "  ssid: y",
      "",
    ].join("\n");
    expect(resolveCurrentFromLine(after, "wifi", /* stale */ 3)).toBe(7);
  });

  it("returns undefined when the section no longer exists", () => {
    expect(resolveCurrentFromLine("esphome:\n  name: x\n", "wifi")).toBeUndefined();
  });

  it("returns undefined on empty yaml or empty sectionKey", () => {
    expect(resolveCurrentFromLine("", "wifi")).toBeUndefined();
    expect(resolveCurrentFromLine("wifi:\n  ssid: x\n", "")).toBeUndefined();
  });

  it("disambiguates duplicate keys by closest stale line", () => {
    // Pathological-but-legal: two `ota.esphome` entries (same
    // key, two list items). When the stale fromLine is 3, the
    // resolver picks the closest match (the dash on line 2),
    // not the second one on line 4.
    const dup = [
      "ota:",
      "  - platform: esphome",
      "    password: a",
      "  - platform: esphome",
      "    password: b",
      "",
    ].join("\n");
    expect(resolveCurrentFromLine(dup, "ota.esphome", 2)).toBe(2);
    expect(resolveCurrentFromLine(dup, "ota.esphome", 4)).toBe(4);
    // Equidistant tie: reduce keeps the first.
    expect(resolveCurrentFromLine(dup, "ota.esphome", 3)).toBe(2);
  });

  it("returns the first match when no stale line is provided", () => {
    const dup = [
      "ota:",
      "  - platform: esphome",
      "  - platform: esphome",
      "",
    ].join("\n");
    expect(resolveCurrentFromLine(dup, "ota.esphome")).toBe(2);
  });

  // ---------------------------------------------------------------
  // Read-path round-trip: resolve → parseYamlSectionValues
  // ---------------------------------------------------------------
  //
  // The section editor's `_loadConfig` calls
  // `resolveCurrentFromLine` and feeds the result into
  // `parseYamlSectionValues`. Pin the integration so a stale
  // cached line (passed as the `staleFromLine` hint) produces
  // values from the *right* section after the YAML has shifted.

  it("read-path round-trip: stale line + shifted yaml seeds the right section", () => {
    // Pre-paste yaml: a single OTA item.
    // Post-paste yaml: a leading top-level block pushed it down.
    const yamlAfterPaste = [
      "esphome:",
      "  name: x",
      "logger:",
      "api:",
      "ota:",
      "  - platform: esphome",
      "    password: secret",
      "",
    ].join("\n");
    // Cached fromLine from before the paste — the stale hint.
    const staleFromLine = 2;
    const resolved = resolveCurrentFromLine(
      yamlAfterPaste,
      "ota.esphome",
      staleFromLine,
    );
    expect(resolved).toBe(6);
    const values = parseYamlSectionValues(
      yamlAfterPaste,
      "ota.esphome",
      resolved!,
    );
    expect(values).toEqual({ platform: "esphome", password: "secret" });
  });

  it("read-path round-trip: missing section yields empty values", () => {
    // The section the editor is trying to load no longer
    // exists in the yaml (user deleted it via the YAML pane).
    // Resolver returns undefined; passing it through to the parser
    // makes it scan for `sectionKey:` at column 0 — for a
    // platform-qualified key like `ota.esphome` no top-level
    // line matches, so values come back empty. The form
    // surfaces an empty section, the right outcome.
    const yaml = "esphome:\n  name: x\n";
    const resolved = resolveCurrentFromLine(yaml, "ota.esphome", 5);
    expect(resolved).toBeUndefined();
    const values = parseYamlSectionValues(
      yaml,
      "ota.esphome",
      resolved,
    );
    expect(values).toEqual({});
  });
});
