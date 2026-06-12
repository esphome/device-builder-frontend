import { beforeEach, describe, expect, it } from "vitest";
import { parseYamlSectionValues } from "../../src/util/yaml-section-reader.js";
import {
  removeSectionFromYaml,
  updateSectionInYaml,
} from "../../src/util/yaml-section-values.js";
import {
  _clearYamlSectionsMemo,
  findFieldLine,
  instanceComponentId,
  parseYamlAutomations,
  parseYamlTopLevelSections,
  resolveCurrentFromLine,
  sectionAtLine,
} from "../../src/util/yaml-sections.js";

/**
 * List-item expansion at non-2-space indents (#1403). Platform list
 * items at column 0 (YAML's zero-indented sequence) or 4 spaces were
 * never expanded, so `switch:\n- platform: template` kept the bare
 * `switch` key, missed the catalog, and rendered as "Custom
 * component" with no docs link or structured editor.
 */

beforeEach(() => {
  _clearYamlSectionsMemo();
});

const COL0 = `switch:
- platform: template
  name: "Buzzer Enabled"
  id: buzzer_enabled
- platform: gpio
  pin: GPIO11
  name: "Dehumidifier"
`;

const FOUR_SPACE = `sensor:
    - platform: dht
      name: "kitchen"
    - platform: bme280
      name: "bedroom"
`;

describe("parseYamlTopLevelSections — list-item indents", () => {
  it("expands column-0 list items", () => {
    const sections = parseYamlTopLevelSections(COL0);
    expect(sections).toHaveLength(2);
    expect(sections[0].platform).toBe("template");
    expect(sections[0].name).toBe("Buzzer Enabled");
    expect(sections[0].id).toBe("buzzer_enabled");
    expect(sections[0].parentKey).toBe("switch");
    expect(sections[0].fromLine).toBe(2);
    expect(sections[0].toLine).toBe(4);
    expect(sections[1].platform).toBe("gpio");
    expect(sections[1].fromLine).toBe(5);
  });

  it("expands 4-space-indented list items", () => {
    const sections = parseYamlTopLevelSections(FOUR_SPACE);
    expect(sections).toHaveLength(2);
    expect(sections[0].platform).toBe("dht");
    expect(sections[0].name).toBe("kitchen");
    expect(sections[1].platform).toBe("bme280");
  });

  it("finds column-0 items behind leading comment lines", () => {
    const yaml = `switch:
# relay bank
- platform: gpio
  pin: GPIO11
`;
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections).toHaveLength(1);
    expect(sections[0].platform).toBe("gpio");
  });

  it("keeps a section with a compact child sequence a singleton", () => {
    // The dashes belong to `networks:`, not to `wifi:` itself — the
    // exact-2-indent scan used to mis-expand wifi into fake items.
    const yaml = `wifi:
  networks:
  - ssid: home
  - ssid: backup
`;
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe("wifi");
    expect(sections[0].parentKey).toBeUndefined();
    expect(instanceComponentId(sections, sections[0])).toBe("wifi");
  });

  it("does not read a compact child sequence's id as the singleton's", () => {
    const yaml = `wifi:
  networks:
  - id: home_net
    ssid: home
`;
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBeUndefined();
  });

  it("extracts a 4-space-indented singleton's id and name", () => {
    const yaml = `uart:
    id: my_uart
    tx_pin: GPIO1
`;
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("my_uart");
  });

  it("ignores a block scalar's dash line and keeps the singleton's id", () => {
    const yaml = `foo:
  bar: |
    - looks like a list
  id: real_id
`;
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections).toHaveLength(1);
    expect(sections[0].parentKey).toBeUndefined();
    expect(sections[0].id).toBe("real_id");
  });
});

describe("section helpers on column-0 items", () => {
  it("assigns positional instance ids", () => {
    const yaml = `switch:
- platform: template
- platform: gpio
`;
    const sections = parseYamlTopLevelSections(yaml);
    expect(instanceComponentId(sections, sections[0])).toBe("switch_0");
    expect(instanceComponentId(sections, sections[1])).toBe("switch_1");
  });

  it("attributes a column-0 dash line to its item", () => {
    const m = sectionAtLine(COL0, 5);
    expect(m?.platform).toBe("gpio");
  });

  it("resolves a platform-qualified key to the dash line", () => {
    expect(resolveCurrentFromLine(COL0, "switch.template")).toBe(2);
    expect(resolveCurrentFromLine(COL0, "switch.gpio")).toBe(5);
  });

  it("maps a field path to its line inside a column-0 item", () => {
    const sections = parseYamlTopLevelSections(COL0);
    expect(findFieldLine(COL0, sections[1], ["pin"])).toBe(6);
  });

  it("emits an automation handle for a handler under a column-0 item", () => {
    const yaml = `switch:
- platform: gpio
  id: my_relay
  name: "Light"
  on_turn_on:
  - logger.log: "on"
`;
    const result = parseYamlAutomations(yaml);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("automation:component_on:my_relay:on_turn_on");
    expect(result[0].displayLabel).toBe("Light → on_turn_on");
  });
});

describe("section values on column-0 items", () => {
  it("reads the inline platform and children without sibling bleed", () => {
    const values = parseYamlSectionValues(COL0, "switch", 2);
    expect(values.platform).toBe("template");
    expect(values.name).toBe("Buzzer Enabled");
    expect(values.id).toBe("buzzer_enabled");
    expect(values.pin).toBeUndefined();
  });

  it("updates one item without duplicating the inline key", () => {
    const updated = updateSectionInYaml(
      COL0,
      "switch",
      {
        platform: "template",
        name: "Buzzer",
        id: "buzzer_enabled",
      },
      2
    );
    expect(updated).toContain("name: Buzzer");
    expect(updated.match(/platform: template/g)).toHaveLength(1);
    // Sibling item untouched.
    expect(updated).toContain("pin: GPIO11");
    expect(updated).toContain('name: "Dehumidifier"');
  });

  it("rewrites a changed inline key on a column-0 dash", () => {
    const updated = updateSectionInYaml(COL0, "switch", { platform: "gpio" }, 2);
    expect(updated.split("\n")[1]).toBe("- platform: gpio");
  });

  it("removes one item and keeps the sibling", () => {
    const removed = removeSectionFromYaml(COL0, "switch", 2);
    expect(removed).not.toContain("buzzer_enabled");
    expect(removed).toContain("platform: gpio");
    expect(removed).toContain("switch:");
  });
});
