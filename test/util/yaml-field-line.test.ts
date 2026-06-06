import { describe, expect, it } from "vitest";
import {
  _clearYamlSectionsMemo,
  findFieldLine,
  parseYamlTopLevelSections,
  type YamlSection,
} from "../../src/util/yaml-sections-core.js";

function sectionAt(yaml: string, fromLine: number): YamlSection {
  _clearYamlSectionsMemo();
  const s = parseYamlTopLevelSections(yaml).find((x) => x.fromLine === fromLine);
  if (!s) throw new Error(`no section at line ${fromLine}`);
  return s;
}

const LIST_YAML = [
  "binary_sensor:",
  "  - platform: gpio",
  "    name: Pan Water",
  "    device_class: moisture",
  "    pin:",
  "      number: GPIO33",
  "      mode: INPUT_PULLUP",
  "",
].join("\n");

describe("findFieldLine", () => {
  it("locates a top-level field inside a list item", () => {
    const section = sectionAt(LIST_YAML, 2); // `- platform: gpio`
    expect(findFieldLine(LIST_YAML, section, ["name"])).toBe(3);
    expect(findFieldLine(LIST_YAML, section, ["device_class"])).toBe(4);
    expect(findFieldLine(LIST_YAML, section, ["platform"])).toBe(2);
  });

  it("locates a nested field", () => {
    const section = sectionAt(LIST_YAML, 2);
    expect(findFieldLine(LIST_YAML, section, ["pin"])).toBe(5);
    expect(findFieldLine(LIST_YAML, section, ["pin", "number"])).toBe(6);
    expect(findFieldLine(LIST_YAML, section, ["pin", "mode"])).toBe(7);
  });

  it("returns null for an unresolved path", () => {
    const section = sectionAt(LIST_YAML, 2);
    expect(findFieldLine(LIST_YAML, section, ["nope"])).toBeNull();
    expect(findFieldLine(LIST_YAML, section, [])).toBeNull();
  });

  it("locates a field in a flat (non-list) section", () => {
    const yaml = ["wifi:", "  ssid: x", "  ap:", "    ssid: y", ""].join("\n");
    const section = sectionAt(yaml, 1);
    expect(findFieldLine(yaml, section, ["ssid"])).toBe(2);
    expect(findFieldLine(yaml, section, ["ap"])).toBe(3);
    expect(findFieldLine(yaml, section, ["ap", "ssid"])).toBe(4);
  });

  it("strips a leading section key (list/map sections key fields under it)", () => {
    const yaml = ["substitutions:", "  devicename: x", "  friendly_name: y", ""].join(
      "\n"
    );
    const section = sectionAt(yaml, 1);
    expect(findFieldLine(yaml, section, ["substitutions", "devicename"])).toBe(2);
    expect(findFieldLine(yaml, section, ["substitutions", "friendly_name"])).toBe(3);
  });

  it("descends a list index into a list-of-maps item (areas)", () => {
    const yaml = [
      "esphome:",
      "  name: x",
      "  areas:",
      "    - name: zombie",
      "      id: ff",
      "    - name: other",
      "      id: gg",
      "",
    ].join("\n");
    const section = sectionAt(yaml, 1);
    expect(findFieldLine(yaml, section, ["name"])).toBe(2);
    expect(findFieldLine(yaml, section, ["areas", "0", "name"])).toBe(4);
    expect(findFieldLine(yaml, section, ["areas", "0", "id"])).toBe(5);
    expect(findFieldLine(yaml, section, ["areas", "1", "id"])).toBe(7);
    expect(findFieldLine(yaml, section, ["areas", "0"])).toBe(4);
    // An optional child absent from the item: null drives the caller's
    // whole-section fallback rather than a stale single-line highlight.
    expect(findFieldLine(yaml, section, ["areas", "0", "name_add_mac"])).toBeNull();
  });

  it("descends a same-indent compact block-sequence value", () => {
    // ``items:`` carries its list at the key's own indent (YAML's compact
    // block-sequence form). The block-end scan must keep those dashes in
    // the block or descending into ``items.0`` fails and returns null.
    const yaml = [
      "wifi:",
      "  group:",
      "    items:",
      "    - ssid: a",
      "    - ssid: b",
      "",
    ].join("\n");
    const section = sectionAt(yaml, 1);
    expect(findFieldLine(yaml, section, ["group", "items", "0", "ssid"])).toBe(4);
    expect(findFieldLine(yaml, section, ["group", "items", "1", "ssid"])).toBe(5);
  });

  it("resolves a numeric mapping key instead of reading it as a list index", () => {
    const yaml = ["substitutions:", "  0: zero", "  name: x", ""].join("\n");
    const section = sectionAt(yaml, 1);
    expect(findFieldLine(yaml, section, ["substitutions", "0"])).toBe(2);
    expect(findFieldLine(yaml, section, ["substitutions", "name"])).toBe(3);
  });

  it("targets the correct instance among duplicates", () => {
    const yaml = [
      "binary_sensor:",
      "  - platform: gpio",
      "    name: First",
      "  - platform: gpio",
      "    name: Second",
      "",
    ].join("\n");
    const second = sectionAt(yaml, 4); // the second `- platform: gpio`
    expect(findFieldLine(yaml, second, ["name"])).toBe(5);
  });
});
