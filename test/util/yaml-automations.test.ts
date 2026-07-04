import { afterEach, describe, expect, it } from "vitest";
import { parseYamlAutomations } from "../../src/util/yaml-automations.js";
import { _clearYamlSectionsMemo } from "../../src/util/yaml-sections-core.js";

// `parseYamlAutomations` leans on `parseYamlTopLevelSections`, which memoises on
// the yaml string. Distinct fixtures key distinctly, but clear the memo between
// tests anyway so no case can be satisfied by a prior parse.
afterEach(() => _clearYamlSectionsMemo());

/** The stable `key`s the parser emits, in document order — the identifier the
 *  page matches against a backend `ParsedAutomation.location`. */
const keys = (yaml: string): string[] => parseYamlAutomations(yaml).map((s) => s.key);

describe("parseYamlAutomations — device-level triggers", () => {
  it("emits a single device_on row for a mapping-form on_boot", () => {
    const yaml = [
      "esphome:",
      "  name: my-device",
      "  on_boot:",
      "    then:",
      "      - logger.log: hi",
      "",
    ].join("\n");
    const rows = parseYamlAutomations(yaml);
    const boot = rows.find((r) => r.key.startsWith("automation:device_on"));
    expect(boot?.key).toBe("automation:device_on:on_boot");
    expect(boot?.displayLabel).toBe("esphome → on_boot");
    expect(boot?.parentKey).toBe("esphome");
    expect(boot?.eventKey).toBe("on_boot");
  });

  it("splits a list-form on_boot into one indexed row per priority entry", () => {
    const yaml = [
      "esphome:",
      "  name: my-device",
      "  on_boot:",
      "    - priority: 800",
      "      then:",
      "        - logger.log: early",
      "    - priority: 200",
      "      then:",
      "        - logger.log: late",
      "",
    ].join("\n");
    const rows = parseYamlAutomations(yaml).filter((r) =>
      r.key.startsWith("automation:device_on")
    );
    expect(rows.map((r) => r.key)).toEqual([
      "automation:device_on:on_boot:0",
      "automation:device_on:on_boot:1",
    ]);
    expect(rows.map((r) => r.displayLabel)).toEqual([
      "esphome → on_boot #1",
      "esphome → on_boot #2",
    ]);
  });
});

describe("parseYamlAutomations — component triggers", () => {
  it("keys an inline on_* handler by the instance id", () => {
    const yaml = [
      "binary_sensor:",
      "  - platform: gpio",
      "    id: my_button",
      "    name: My Button",
      "    on_press:",
      "      then:",
      "        - logger.log: pressed",
      "",
    ].join("\n");
    const rows = parseYamlAutomations(yaml);
    const press = rows.find((r) => r.key.startsWith("automation:component_on"));
    expect(press?.key).toBe("automation:component_on:my_button:on_press");
    expect(press?.displayLabel).toBe("My Button → on_press");
    expect(press?.id).toBe("my_button");
    expect(press?.eventKey).toBe("on_press");
  });

  it("splits a list-form on_time into one indexed row per cron entry", () => {
    const yaml = [
      "time:",
      "  - platform: sntp",
      "    id: my_time",
      "    on_time:",
      "      - seconds: 0",
      "        minutes: 0",
      "        then:",
      "          - logger.log: tick",
      '      - cron: "0 0 12 * * *"',
      "        then:",
      "          - logger.log: noon",
      "",
    ].join("\n");
    expect(keys(yaml)).toEqual([
      "automation:component_on:my_time:on_time:0",
      "automation:component_on:my_time:on_time:1",
    ]);
  });

  it("emits a component_action row for a bare *_action config field", () => {
    const yaml = [
      "cover:",
      "  - platform: template",
      "    id: my_cover",
      "    open_action:",
      "      - switch.turn_on: relay",
      "",
    ].join("\n");
    const rows = parseYamlAutomations(yaml);
    const action = rows.find((r) => r.key.startsWith("automation:component_action"));
    expect(action?.key).toBe("automation:component_action:my_cover:open_action");
    expect(action?.displayLabel).toBe("my_cover → open_action");
    expect(action?.actionField).toBe("open_action");
  });

  it("does not double-count an on_*_action key as both trigger and action", () => {
    const yaml = [
      "cover:",
      "  - platform: template",
      "    id: my_cover",
      "    on_open_action:",
      "      then:",
      "        - logger.log: opened",
      "",
    ].join("\n");
    // `on_open_action` starts with `on_`, so the action pass skips it; only the
    // trigger pass claims it — exactly one row, keyed as a component_on.
    expect(keys(yaml)).toEqual(["automation:component_on:my_cover:on_open_action"]);
  });
});

describe("parseYamlAutomations — top-level callable blocks", () => {
  it("keys a script list item by its id", () => {
    const yaml = [
      "script:",
      "  - id: my_script",
      "    then:",
      "      - logger.log: run",
      "",
    ].join("\n");
    const rows = parseYamlAutomations(yaml);
    const script = rows.find((r) => r.key.startsWith("automation:script"));
    expect(script?.key).toBe("automation:script:my_script");
    expect(script?.displayLabel).toBe("script: my_script");
    expect(script?.id).toBe("my_script");
  });

  it("indexes interval items and surfaces the every-duration in meta", () => {
    const yaml = [
      "interval:",
      "  - interval: 60s",
      "    then:",
      "      - logger.log: tick",
      "",
    ].join("\n");
    const rows = parseYamlAutomations(yaml);
    const interval = rows.find((r) => r.key.startsWith("automation:interval"));
    expect(interval?.key).toBe("automation:interval:0");
    expect(interval?.displayLabel).toBe("interval #1");
    expect(interval?.meta?.every).toBe("60s");
  });

  it("keys an api.actions item by its action name", () => {
    const yaml = [
      "api:",
      "  actions:",
      "    - action: start_laundry",
      "      then:",
      "        - logger.log: go",
      "",
    ].join("\n");
    const rows = parseYamlAutomations(yaml);
    const action = rows.find((r) => r.key.startsWith("automation:api_action"));
    expect(action?.key).toBe("automation:api_action:start_laundry");
    expect(action?.displayLabel).toBe("API: start_laundry");
    expect(action?.parentKey).toBe("api");
  });

  it("falls back to the legacy `service:` key for an api action name", () => {
    const yaml = [
      "api:",
      "  actions:",
      "    - service: legacy_call",
      "      then:",
      "        - logger.log: go",
      "",
    ].join("\n");
    expect(keys(yaml)).toContain("automation:api_action:legacy_call");
  });
});

describe("parseYamlAutomations — empty / no-automation input", () => {
  it("returns an empty array for config with no automations", () => {
    const yaml = ["wifi:", "  ssid: home", "  password: secret", ""].join("\n");
    expect(parseYamlAutomations(yaml)).toEqual([]);
  });

  it("returns an empty array for the empty string", () => {
    expect(parseYamlAutomations("")).toEqual([]);
  });
});
