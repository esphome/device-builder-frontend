/**
 * @vitest-environment happy-dom
 *
 * Pins `_shortcutTarget` — the per-section "+ Add automation" / triggers-
 * list gate. It is the second consumer of `instanceComponentId`; the
 * regression Kōan/Copilot flagged was this gate drifting from
 * `parseYamlAutomations` (a flat block with an explicit id offered a
 * shortcut the parser scoped as `unscoped`). These tests lock the gate's
 * classification and assert it agrees with the parser for the same YAML.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import {
  _clearYamlSectionsMemo,
  parseYamlAutomations,
} from "../../../src/util/yaml-sections.js";

type Target =
  | null
  | { kind: "device_on" }
  | { kind: "component_on"; componentId: string };

/** Drive `_shortcutTarget` in isolation — it reads only `yaml`,
 *  `sectionKey`, and `_resolvedFromLine`, no DOM / API. */
const shortcutTarget = (
  yaml: string,
  sectionKey: string,
  resolvedFromLine?: number
): Target => {
  const c = new ESPHomeDeviceSectionConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inner = c as any;
  inner.yaml = yaml;
  inner.sectionKey = sectionKey;
  if (resolvedFromLine !== undefined) inner._resolvedFromLine = resolvedFromLine;
  return inner._shortcutTarget();
};

beforeEach(() => {
  _clearYamlSectionsMemo();
});

describe("_shortcutTarget", () => {
  it("returns device_on for the esphome block", () => {
    expect(shortcutTarget("esphome:\n  name: x\n", "esphome")).toEqual({
      kind: "device_on",
    });
  });

  it("returns null for hide-keys (api / script / substitutions …)", () => {
    const yaml = "substitutions:\n  foo: bar\n";
    expect(shortcutTarget(yaml, "substitutions")).toBeNull();
  });

  it("scopes an id-less list instance to its positional id", () => {
    const yaml = `switch:
  - platform: template
    name: My Switch
    on_turn_on:
      - logger.log: "on"
`;
    expect(shortcutTarget(yaml, "switch.template")).toEqual({
      kind: "component_on",
      componentId: "switch_0",
    });
  });

  it("uses the declared id for an id'd list instance", () => {
    const yaml = `switch:
  - platform: gpio
    id: my_relay
    on_turn_on:
      - logger.log: "on"
`;
    expect(shortcutTarget(yaml, "switch.gpio")).toEqual({
      kind: "component_on",
      componentId: "my_relay",
    });
  });

  it("returns null for a flat block even with an explicit id (no broken shortcut)", () => {
    // The exact regression: `sun:` is a flat single-instance block that
    // can carry an id and host on_sunrise, but the backend can't address
    // it, so the gate must offer no shortcut (matching the parser's
    // `unscoped`).
    const yaml = `sun:
  id: my_sun
  latitude: 0°
  on_sunrise:
    - then:
        - logger.log: "x"
`;
    expect(shortcutTarget(yaml, "sun")).toBeNull();
  });

  it("routes multi-instance sections by _resolvedFromLine", () => {
    const yaml = `switch:
  - platform: template
    name: A
    on_turn_on:
      - logger.log: "a"
  - platform: template
    name: B
    on_turn_on:
      - logger.log: "b"
`;
    expect(shortcutTarget(yaml, "switch.template", 2)).toEqual({
      kind: "component_on",
      componentId: "switch_0",
    });
    expect(shortcutTarget(yaml, "switch.template", 6)).toEqual({
      kind: "component_on",
      componentId: "switch_1",
    });
  });

  it("agrees with parseYamlAutomations on the component id (no caller drift)", () => {
    // Same fixture through both callers; the triggers list filters parsed
    // automations by `s.id === target.componentId`, so these must match.
    const cases: Array<[string, string]> = [
      [
        `switch:\n  - platform: template\n    name: My Switch\n    on_turn_on:\n      - logger.log: "on"\n`,
        "switch.template",
      ],
      [
        `switch:\n  - platform: gpio\n    id: my_relay\n    on_turn_on:\n      - logger.log: "on"\n`,
        "switch.gpio",
      ],
    ];
    for (const [yaml, sectionKey] of cases) {
      _clearYamlSectionsMemo();
      const target = shortcutTarget(yaml, sectionKey);
      const parsed = parseYamlAutomations(yaml).find((s) =>
        s.key.startsWith("automation:component_on:")
      );
      expect(target).not.toBeNull();
      expect(parsed?.id).toBe(
        (target as { kind: "component_on"; componentId: string }).componentId
      );
    }
  });
});
