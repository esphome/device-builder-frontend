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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { AutomationTrigger } from "../../../src/api/types/automations.js";
import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import {
  _clearAutomationCatalogCache,
  fetchAutomationTriggers,
} from "../../../src/util/automation-catalog-cache.js";
import {
  _clearYamlSectionsMemo,
  parseYamlAutomations,
} from "../../../src/util/yaml-sections.js";

type Target =
  null | { kind: "device_on" } | { kind: "component_on"; componentId: string };

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

/** Seed the module trigger cache (keyed on undefined platform/board, as a
 *  boardless test component resolves) so ``hasTriggersFor`` sees them.
 *  A bare id seeds ``applies_to: [<domain>]``; a ``[id, applies_to]`` pair
 *  seeds an explicit (e.g. platform-qualified) scope. */
const seedTriggers = (specs: Array<string | [string, string[]]>): Promise<unknown> => {
  const triggers = specs.map((s) => {
    const [id, applies_to] = typeof s === "string" ? [s, [s.split(".")[0]]] : s;
    return { id, applies_to };
  }) as unknown as AutomationTrigger[];
  const api = { getAutomationTriggers: async () => triggers } as unknown as ESPHomeAPI;
  return fetchAutomationTriggers(api, undefined, undefined);
};

beforeEach(() => {
  _clearYamlSectionsMemo();
});

afterEach(() => {
  // Drop any seeded catalog so other tests keep their fail-open (no
  // catalog → ``hasTriggersFor`` returns true) behavior.
  _clearAutomationCatalogCache();
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

  it("scopes a flat singleton block to its id (sun → its declared id)", () => {
    // With backend flat-component support (#1139), `sun:` is addressable
    // by its `id:`, so the section hosts automations like a list item.
    const yaml = `sun:
  id: my_sun
  latitude: 0°
  on_sunrise:
    - then:
        - logger.log: "x"
`;
    expect(shortcutTarget(yaml, "sun")).toEqual({
      kind: "component_on",
      componentId: "my_sun",
    });
  });

  it("scopes an id-less flat singleton block to its domain", () => {
    const yaml = `mqtt:
  broker: test
  on_message:
    - topic: x/y
      then:
        - logger.log: "m"
`;
    expect(shortcutTarget(yaml, "mqtt")).toEqual({
      kind: "component_on",
      componentId: "mqtt",
    });
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

  it("hides the panel for a trigger-less domain once the catalog loads", async () => {
    await seedTriggers(["sun.on_sunrise", "switch.on_turn_on"]);
    // web_server has no catalog triggers → no automations panel.
    expect(shortcutTarget("web_server:\n  port: 80\n", "web_server")).toBeNull();
    // sun does → still offered.
    expect(shortcutTarget("sun:\n  id: my_sun\n", "sun")).toEqual({
      kind: "component_on",
      componentId: "my_sun",
    });
  });

  it("matches a trigger scoped to the qualified <domain>.<platform>", async () => {
    // output's triggers list the platform-qualified scope (``output.slow_pwm``),
    // not the bare domain — the gate must still offer the panel.
    await seedTriggers([["slow_pwm.output.turn_on_action", ["output.slow_pwm"]]]);
    const yaml = `output:\n  - platform: slow_pwm\n    id: my_out\n    pin: GPIO1\n`;
    expect(shortcutTarget(yaml, "output.slow_pwm")).toEqual({
      kind: "component_on",
      componentId: "my_out",
    });
  });
});
