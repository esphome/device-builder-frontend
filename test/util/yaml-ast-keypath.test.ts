import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import { getKeyPath, isInsideBlockScalar } from "../../src/util/yaml-ast.js";

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

  it("resolves a nested empty value at a trailing space (key: )", () => {
    // ``minimum_chip_revision: `` with the cursor after the space resolves to
    // the document root; re-anchoring on the line's last non-space char must
    // still yield the full path so value completion fires.
    const doc = "esp32:\n  framework:\n    advanced:\n      minimum_chip_revision: \n";
    const state = EditorState.create({ doc, extensions: [esphomeYaml()] });
    ensureSyntaxTree(state, state.doc.length);
    const marker = "minimum_chip_revision: ";
    const pos = doc.indexOf(marker) + marker.length;
    expect(getKeyPath(state, pos)).toEqual([
      "esp32",
      "framework",
      "advanced",
      "minimum_chip_revision",
    ]);
  });

  it("returns [] outside any mapping pair", () => {
    expect(pathAt("# comment\n", "comment")).toEqual([]);
  });
});

describe("isInsideBlockScalar", () => {
  const at = (doc: string, token: string): boolean => {
    const state = EditorState.create({ doc, extensions: [esphomeYaml()] });
    ensureSyntaxTree(state, state.doc.length);
    return isInsideBlockScalar(state, doc.indexOf(token) + token.length);
  };

  it("is true for a `key:`-looking line inside a block scalar body", () => {
    // `done:` is a C++ label in a lambda body — literal text, not a YAML pair.
    const doc =
      "sensor:\n  - platform: template\n    lambda: |-\n      done:\n      return 0;\n";
    expect(at(doc, "done:")).toBe(true);
  });

  it("is false on a real empty-value key line", () => {
    const doc = "sensor:\n  - platform: template\n    device_class:\n";
    expect(at(doc, "device_class:")).toBe(false);
  });
});
