import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import { getKeyPath } from "../../src/util/yaml-ast.js";

function pathAt(doc: string, token: string): string[] {
  const state = EditorState.create({ doc, extensions: [esphomeYaml()] });
  ensureSyntaxTree(state, state.doc.length);
  const pos = doc.indexOf(token) + 1;
  return getKeyPath(state, pos);
}

describe("getKeyPath", () => {
  it("returns the full key chain for a nested field", () => {
    const doc = "esp32_ble_tracker:\n  scan_parameters:\n    active: false\n";
    expect(pathAt(doc, "active")).toEqual([
      "esp32_ble_tracker",
      "scan_parameters",
      "active",
    ]);
  });

  it("omits list-item wrappers — slice(1) drops the section key for the form path", () => {
    const doc =
      "binary_sensor:\n  - platform: gpio\n    name: x\n    pin:\n      number: D1\n";
    // getKeyPath only collects mapping-pair keys (the ``- `` list-item adds
    // none), so the chain here is [binary_sensor, name]; the page slices off
    // the leading section key to match the instance-relative data-field-key.
    expect(pathAt(doc, "name").slice(1)).toEqual(["name"]);
    expect(pathAt(doc, "number").slice(1)).toEqual(["pin", "number"]);
  });

  it("returns [] outside any mapping pair", () => {
    expect(pathAt("# comment\n", "comment")).toEqual([]);
  });
});
