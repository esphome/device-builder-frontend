/**
 * Unit-pins the pure ``shortcut-target`` module lifted out of
 * ``device-section-config``: ``resolveComponentMatch`` /
 * ``resolveComponentId`` (yaml + key + line → addressable instance) and
 * ``resolveShortcutTarget`` (the "+ Add automation" gate). The catalog gate
 * is injected as ``hasTriggers`` so these run with no DOM, controller, or
 * live API — the component's ``_shortcutTarget`` is now a thin wrapper over
 * this, exercised end-to-end in ``section-config-shortcut-target.test.ts``.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  resolveComponentId,
  resolveComponentMatch,
  resolveShortcutTarget,
  SHORTCUT_HIDE_KEYS,
} from "../../../src/components/device/device-section-config/shortcut-target.js";
import { _clearYamlSectionsMemo } from "../../../src/util/yaml-sections.js";

/** Default gate: every component has triggers (matches the fail-open
 *  behaviour before the catalog loads). */
const yesTriggers = () => true;

beforeEach(() => {
  _clearYamlSectionsMemo();
});

describe("resolveComponentMatch / resolveComponentId", () => {
  it("returns null for a key with no matching section", () => {
    expect(resolveComponentMatch("esphome:\n  name: x\n", "switch.gpio")).toBeNull();
    expect(resolveComponentId("esphome:\n  name: x\n", "switch.gpio")).toBeNull();
  });

  it("resolves an id-less list instance to its positional id", () => {
    const yaml = `switch:
  - platform: template
    name: My Switch
    on_turn_on:
      - logger.log: "on"
`;
    expect(resolveComponentId(yaml, "switch.template")).toBe("switch_0");
  });

  it("resolves a declared id on a list instance", () => {
    const yaml = `switch:
  - platform: gpio
    id: my_relay
    on_turn_on:
      - logger.log: "on"
`;
    expect(resolveComponentId(yaml, "switch.gpio")).toBe("my_relay");
  });

  it("routes a multi-instance section by resolvedFromLine", () => {
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
    expect(resolveComponentId(yaml, "switch.template", 2)).toBe("switch_0");
    expect(resolveComponentId(yaml, "switch.template", 6)).toBe("switch_1");
  });

  it("falls back to the first candidate when fromLine matches nothing", () => {
    const yaml = `switch:
  - platform: template
    name: A
    on_turn_on:
      - logger.log: "a"
`;
    expect(resolveComponentId(yaml, "switch.template", 999)).toBe("switch_0");
  });
});

describe("resolveShortcutTarget", () => {
  it("returns null for every hide-key", () => {
    for (const key of SHORTCUT_HIDE_KEYS) {
      expect(
        resolveShortcutTarget(`${key}:\n  foo: bar\n`, key, undefined, yesTriggers)
      ).toBeNull();
    }
  });

  it("returns device_on for the esphome block", () => {
    expect(
      resolveShortcutTarget("esphome:\n  name: x\n", "esphome", undefined, yesTriggers)
    ).toEqual({ kind: "device_on" });
  });

  it("returns null when no section matches the key", () => {
    expect(
      resolveShortcutTarget(
        "esphome:\n  name: x\n",
        "switch.gpio",
        undefined,
        yesTriggers
      )
    ).toBeNull();
  });

  it("returns component_on keyed by the resolved instance id", () => {
    const yaml = `switch:
  - platform: gpio
    id: my_relay
    on_turn_on:
      - logger.log: "on"
`;
    expect(resolveShortcutTarget(yaml, "switch.gpio", undefined, yesTriggers)).toEqual({
      kind: "component_on",
      componentId: "my_relay",
    });
  });

  it("hides the panel when the gate reports no triggers", () => {
    const yaml = "web_server:\n  port: 80\n";
    expect(resolveShortcutTarget(yaml, "web_server", undefined, () => false)).toBeNull();
  });

  it("passes the bare domain and qualified key to the gate", () => {
    const yaml = `output:
  - platform: slow_pwm
    id: my_out
    pin: GPIO1
`;
    const seen: string[][] = [];
    resolveShortcutTarget(yaml, "output.slow_pwm", undefined, (scopes) => {
      seen.push(scopes);
      return true;
    });
    // parentKey (bare domain "output") first, then the section key.
    expect(seen).toEqual([["output", "output.slow_pwm"]]);
  });
});
