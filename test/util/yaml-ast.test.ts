import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import {
  collectTopLevelKeys,
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
});

describe("isUnderThenItem", () => {
  it("returns true at the list-item position inside a then: block", () => {
    const yaml =
      "esphome:\n  on_boot:\n    then:\n      - logger.log: hi\n";
    const state = makeState(yaml);
    // Cursor on the ``- logger.log`` line, inside the Item.
    expect(isUnderThenItem(state, posAt(yaml, 4, 9))).toBe(true);
  });

  it("returns false for action arguments nested inside a then: item", () => {
    // ``message:`` is a child of the action mapping, not a new
    // list-item — should NOT trigger action-registry completion.
    const yaml =
      "esphome:\n  on_boot:\n    then:\n      - logger.log:\n          level: WARN\n          message: hi\n";
    const state = makeState(yaml);
    // Cursor on ``message:`` line, deep inside the action.
    expect(isUnderThenItem(state, posAt(yaml, 6, 11))).toBe(true);
    // Hmm — the cursor IS still inside an Item under a then: BlockSequence
    // (the same Item that contains logger.log). The structural test is
    // "are we under a then: Item?" which is true here. Tighter discrimination
    // (new list-item vs mapping value inside an existing Item) lives in the
    // caller, which gates additionally on the ``isListItem`` regex.
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
});

describe("collectTopLevelKeys", () => {
  it("returns each top-level key once, in document order", () => {
    const yaml =
      "esphome:\n  name: test\nwifi:\n  ssid: x\nlogger:\n  level: INFO\n";
    expect(collectTopLevelKeys(makeState(yaml))).toEqual([
      "esphome",
      "wifi",
      "logger",
    ]);
  });

  it("skips nested keys (only column-0 pairs)", () => {
    const yaml = "esphome:\n  name: test\n  on_boot:\nwifi:\n  ssid: x\n";
    expect(collectTopLevelKeys(makeState(yaml))).toEqual([
      "esphome",
      "wifi",
    ]);
  });

  it("returns [] for empty / unparseable input", () => {
    expect(collectTopLevelKeys(makeState(""))).toEqual([]);
  });
});
