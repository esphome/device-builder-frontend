import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import {
  collectSubstitutionKeys,
  collectTopLevelKeys,
  getPlatformValue,
  getTopLevelKey,
  isUnderThenItem,
  resolveBundleContext,
} from "../../src/util/yaml-ast.js";

function makeState(yaml: string): EditorState {
  return EditorState.create({ doc: yaml, extensions: [esphomeYaml()] });
}

/** Find the (1-based) line / column position in *yaml* and return the
 *  document offset. Helper to write readable position assertions. */
function posAt(yaml: string, line: number, col: number): number {
  const lines = yaml.split("\n");
  let off = 0;
  for (let i = 0; i < line - 1; i++) off += lines[i].length + 1;
  return off + col - 1;
}

describe("resolveBundleContext", () => {
  it("returns the top-level key under a plain component block", () => {
    const yaml = "esphome:\n  name: test\n  on_boot:\n";
    const state = makeState(yaml);
    // Cursor inside ``esphome:`` body — line 3, col 3 ("  o" of on_boot).
    const ctx = resolveBundleContext(state, posAt(yaml, 3, 3));
    expect(ctx).toEqual({ topLevelKey: "esphome", platformValue: null });
  });

  it("returns the platform value for list-of-mappings blocks", () => {
    const yaml = "binary_sensor:\n  - platform: gpio\n    pin: 5\n";
    const state = makeState(yaml);
    // Cursor inside the gpio item — line 3, col 5.
    const ctx = resolveBundleContext(state, posAt(yaml, 3, 5));
    expect(ctx).toEqual({
      topLevelKey: "binary_sensor",
      platformValue: "gpio",
    });
  });

  it("strips quotes from quoted platform values", () => {
    const yaml = 'sensor:\n  - platform: "dht"\n    pin: 5\n';
    const state = makeState(yaml);
    const ctx = resolveBundleContext(state, posAt(yaml, 3, 5));
    expect(ctx?.platformValue).toBe("dht");
  });

  it("returns null when there's no enclosing top-level pair", () => {
    const state = makeState("");
    expect(resolveBundleContext(state, 0)).toBeNull();
  });

  it("resolves bundle context at a partial-key position mid-edit", () => {
    // User's actual scenario: typing ``o`` for ``on_press`` after
    // a fully-typed list-item header. The ``o`` is an incomplete
    // Pair (no value yet), and we need the trigger lookup to fire.
    const yaml = [
      "binary_sensor:",
      "  - platform: gpio",
      "    id: button",
      "    name: Gate Trigger 32 Relay",
      "    pin: 21",
      "    o",
    ].join("\n");
    const state = makeState(yaml);
    const ctx = resolveBundleContext(state, yaml.length);
    expect(ctx).toEqual({
      topLevelKey: "binary_sensor",
      platformValue: "gpio",
    });
  });

  it("resolves bundle context immediately after the list-item header", () => {
    // User-reported case: typing ``pi`` on the line right after
    // ``- platform: gpio``. The regex walker
    // (``readPlatformSibling``) breaks at the dash column and
    // misses the ``platform:`` sibling — the AST is what makes
    // this work. Pin the resolution at exactly that position.
    const yaml = ["binary_sensor:", "  - platform: gpio", "    pi"].join("\n");
    const state = makeState(yaml);
    const ctx = resolveBundleContext(state, yaml.length);
    expect(ctx).toEqual({
      topLevelKey: "binary_sensor",
      platformValue: "gpio",
    });
  });

  it("resolves bundle context with non-canonical 4-space indent", () => {
    // User-reported case: typing ``nam`` under ``sensor: -
    // platform: uptime`` with the dash at 4-space indent (body
    // keys at 6 spaces). YAML accepts any consistent indent; the
    // AST should resolve the same context regardless of whether
    // the user picked 2- or 4-space style.
    const yaml = ["sensor:", "    - platform: uptime", "      nam"].join("\n");
    const state = makeState(yaml);
    const ctx = resolveBundleContext(state, yaml.length);
    expect(ctx).toEqual({
      topLevelKey: "sensor",
      platformValue: "uptime",
    });
  });

  it("resolves bundle context after a fully-typed sibling line", () => {
    // ``device_clas`` typed on the third body line (after
    // ``platform`` and ``name`` siblings already exist). Pin the
    // resolution so the schema fallback fires for the right
    // ``sensor.uptime`` target even when the cursor isn't on the
    // line right under the list-item header.
    const yaml = [
      "sensor:",
      "    - platform: uptime",
      '      name: "bob"',
      "      device_clas",
    ].join("\n");
    const state = makeState(yaml);
    const ctx = resolveBundleContext(state, yaml.length);
    expect(ctx).toEqual({
      topLevelKey: "sensor",
      platformValue: "uptime",
    });
  });
});

describe("getTopLevelKey", () => {
  it("returns the column-0 ancestor key", () => {
    const yaml =
      "esphome:\n  name: test\nbinary_sensor:\n  - platform: gpio\n    pin: 5\n";
    const state = makeState(yaml);
    expect(getTopLevelKey(state, posAt(yaml, 2, 5))).toBe("esphome");
    expect(getTopLevelKey(state, posAt(yaml, 5, 5))).toBe("binary_sensor");
  });

  it("returns null at the top of an empty doc", () => {
    expect(getTopLevelKey(makeState(""), 0)).toBeNull();
  });
});

describe("getPlatformValue", () => {
  it("returns the platform sibling for list-of-mappings blocks", () => {
    const yaml = "binary_sensor:\n  - platform: gpio\n    pin: 5\n";
    const state = makeState(yaml);
    expect(getPlatformValue(state, posAt(yaml, 3, 5))).toBe("gpio");
  });

  it("strips quotes from QuotedLiteral platform values", () => {
    const yaml = 'sensor:\n  - platform: "dht"\n    pin: 5\n';
    const state = makeState(yaml);
    expect(getPlatformValue(state, posAt(yaml, 3, 5))).toBe("dht");
  });

  it("returns null when the cursor isn't inside a list-item", () => {
    const yaml = "esphome:\n  name: test\n";
    const state = makeState(yaml);
    expect(getPlatformValue(state, posAt(yaml, 2, 5))).toBeNull();
  });

  it("returns null when the list-item has no platform sibling", () => {
    const yaml = "switch:\n  - id: foo\n    name: bar\n";
    const state = makeState(yaml);
    expect(getPlatformValue(state, posAt(yaml, 3, 5))).toBeNull();
  });

  it("walks past inner Items to find the outer platform-declaring one", () => {
    // Cursor inside the nested ``filters:`` item under the
    // sensor's ``- platform: uptime`` block. The immediate
    // enclosing Item is the filters' inner item (which has its
    // own platform-less mapping); the walker must keep walking
    // up to the outer sensor item to resolve the platform
    // context. Without this, registry completion at deeper
    // nesting can't query the right schema bundle.
    const yaml = [
      "sensor:",
      "  - platform: uptime",
      "    name: zwave",
      "    filters:",
      "      - clamp:",
      "          min_value: 0",
    ].join("\n");
    const state = makeState(yaml);
    // Cursor inside the ``min_value: 0`` line.
    expect(getPlatformValue(state, posAt(yaml, 6, 12))).toBe("uptime");
  });
});

describe("isUnderThenItem", () => {
  it("returns true at the list-item position inside a then: block", () => {
    const yaml = "esphome:\n  on_boot:\n    then:\n      - logger.log: hi\n";
    const state = makeState(yaml);
    // Cursor on the ``- logger.log`` line, inside the Item.
    expect(isUnderThenItem(state, posAt(yaml, 4, 9))).toBe(true);
  });

  it("returns true even for nested action arguments under a then: item", () => {
    // ``message:`` is a child of the action mapping (deep inside
    // the same Item that contains ``logger.log``). The structural
    // test is "are we under a then: Item?" which is still true
    // here — tighter discrimination (new list-item vs mapping
    // value inside an existing Item) is the caller's job: the
    // completion source additionally gates on the ``isListItem``
    // line-text matcher so action-registry completion only fires
    // at the dash position.
    const yaml =
      "esphome:\n  on_boot:\n    then:\n      - logger.log:\n          level: WARN\n          message: hi\n";
    const state = makeState(yaml);
    expect(isUnderThenItem(state, posAt(yaml, 6, 11))).toBe(true);
  });

  it("returns false outside a then: block", () => {
    const yaml = "esphome:\n  name: test\n  on_boot:\n";
    const state = makeState(yaml);
    expect(isUnderThenItem(state, posAt(yaml, 2, 5))).toBe(false);
    expect(isUnderThenItem(state, posAt(yaml, 3, 3))).toBe(false);
  });

  it("returns false when ``then`` is the key but cursor is the value side", () => {
    const yaml = "esphome:\n  on_boot:\n    then: !lambda return 1;\n";
    const state = makeState(yaml);
    // Inline value form, no BlockSequence — not an automation body.
    expect(isUnderThenItem(state, posAt(yaml, 3, 25))).toBe(false);
  });

  it("recognises cover-style ``*_action:`` bodies as automation lists", () => {
    // ``open_action:`` / ``close_action:`` / ``stop_action:`` are
    // declared as ``type: trigger`` in the schema; the action
    // registry should fire at their list-item positions just like
    // it does under ``then:``. Without this, picking
    // ``- switch.turn_off:`` at the dash position misses the
    // registry and falls back to plain key completion.
    const yaml =
      "cover:\n  - platform: feedback\n    open_action:\n      - switch.turn_off: foo\n";
    const state = makeState(yaml);
    expect(isUnderThenItem(state, posAt(yaml, 4, 9))).toBe(true);
  });

  it("recognises ``else:`` as an automation list", () => {
    const yaml =
      "esphome:\n  on_boot:\n    then:\n      - if:\n          condition:\n            switch.is_on: foo\n          then:\n            - delay: 1s\n          else:\n            - delay: 2s\n";
    const state = makeState(yaml);
    // Cursor on the ``- delay: 2s`` line under ``else:``.
    expect(isUnderThenItem(state, posAt(yaml, 10, 14))).toBe(true);
  });
});

describe("collectTopLevelKeys", () => {
  it("returns each top-level key once, in document order", () => {
    const yaml = "esphome:\n  name: test\nwifi:\n  ssid: x\nlogger:\n  level: INFO\n";
    expect(collectTopLevelKeys(makeState(yaml))).toEqual(["esphome", "wifi", "logger"]);
  });

  it("skips nested keys (only column-0 pairs)", () => {
    const yaml = "esphome:\n  name: test\n  on_boot:\nwifi:\n  ssid: x\n";
    expect(collectTopLevelKeys(makeState(yaml))).toEqual(["esphome", "wifi"]);
  });

  it("returns [] for empty / unparseable input", () => {
    expect(collectTopLevelKeys(makeState(""))).toEqual([]);
  });
});

describe("collectSubstitutionKeys", () => {
  it("reads keys from a substitutions: mapping", () => {
    const yaml = [
      "substitutions:",
      "  id_prefix: driveway_gate",
      "  devicename: drivewaygate",
      "  upper_devicename: Driveway Gate",
      "esphome:",
      "  name: ${devicename}",
    ].join("\n");
    expect(collectSubstitutionKeys(makeState(yaml))).toEqual([
      "id_prefix",
      "devicename",
      "upper_devicename",
    ]);
  });

  it("returns [] when there is no substitutions: block", () => {
    const yaml = "esphome:\n  name: foo\n";
    expect(collectSubstitutionKeys(makeState(yaml))).toEqual([]);
  });

  it("returns [] for empty / unparseable input", () => {
    expect(collectSubstitutionKeys(makeState(""))).toEqual([]);
  });

  it("returns [] when substitutions: has no body yet", () => {
    const yaml = "substitutions:\nesphome:\n  name: foo\n";
    expect(collectSubstitutionKeys(makeState(yaml))).toEqual([]);
  });
});
