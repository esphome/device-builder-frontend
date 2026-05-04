import { describe, expect, it } from "vitest";
import {
  categorizeSections,
  parseYamlAutomations,
  parseYamlTopLevelSections,
  type YamlSection,
} from "../../src/util/yaml-sections.js";

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

  it("finds inline on_* handlers", () => {
    const yaml = `binary_sensor:
  - platform: gpio
    name: "my_button"
    on_press:
      - logger.log: "pressed"
`;
    const result = parseYamlAutomations(yaml);
    expect(result).toHaveLength(1);
    expect(result[0].key).toContain("on_press");
  });

  it("prefixes the nearest parent name:", () => {
    const yaml = `binary_sensor:
  - platform: gpio
    name: "my_button"
    on_press:
      - logger.log: "pressed"
`;
    const [entry] = parseYamlAutomations(yaml);
    expect(entry.key).toBe("my_button → on_press");
  });

  it("handles multiple handlers on the same component", () => {
    const yaml = `switch:
  - platform: gpio
    name: "light"
    on_turn_on:
      - logger.log: "on"
    on_turn_off:
      - logger.log: "off"
`;
    const result = parseYamlAutomations(yaml);
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("light → on_turn_on");
    expect(result[1].key).toBe("light → on_turn_off");
  });

  it("falls back to the event name when no parent name exists", () => {
    const yaml = `esphome:
  on_boot:
    - logger.log: "boot"
`;
    const [entry] = parseYamlAutomations(yaml);
    expect(entry.key).toBe("on_boot");
  });
});
