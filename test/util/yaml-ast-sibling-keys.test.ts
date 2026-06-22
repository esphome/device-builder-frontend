import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import { collectSiblingKeys } from "../../src/util/yaml-ast.js";

function siblingsAt(yaml: string, pos: number): string[] {
  const state = EditorState.create({ doc: yaml, extensions: [esphomeYaml()] });
  return [...collectSiblingKeys(state, pos)].sort();
}

describe("collectSiblingKeys", () => {
  it("returns the sibling keys of the cursor's mapping", () => {
    const yaml = ["esphome:", "  name: foo", "  friendly_name: bar", "  c"].join("\n");
    expect(siblingsAt(yaml, yaml.length)).toEqual(["friendly_name", "name"]);
  });

  it("returns the top-level keys when the cursor is at column 0", () => {
    const yaml = ["esphome:", "  name: foo", "wifi:", "  ssid: x", "l"].join("\n");
    expect(siblingsAt(yaml, yaml.length)).toEqual(["esphome", "wifi"]);
  });

  it("excludes the pair the cursor is editing in place", () => {
    const yaml = ["esphome:", "  name: foo"].join("\n");
    const pos = yaml.indexOf("name") + 2;
    expect(siblingsAt(yaml, pos)).toEqual([]);
  });

  it("is scoped to the current list-item mapping, not sibling items", () => {
    // Each ``- `` starts its own mapping, so a repeated field in a
    // second item must not see the first item's keys (list items are
    // legitimately repeatable).
    const yaml = [
      "sensor:",
      "  - platform: dht",
      "    name: a",
      "  - platform: dht",
      "    n",
    ].join("\n");
    expect(siblingsAt(yaml, yaml.length)).toEqual(["platform"]);
  });

  it("includes an empty block opener above the cursor", () => {
    // ``captive_portal:`` / ``debug:`` etc. with no children absorb the
    // line below as their value; the new sibling key beneath must still
    // see them so they aren't re-suggested.
    const yaml = ["wifi:", "  ssid: x", "captive_portal:", "d"].join("\n");
    expect(siblingsAt(yaml, yaml.length)).toEqual(["captive_portal", "wifi"]);
  });

  it("returns an empty set when the cursor isn't inside a mapping", () => {
    expect(siblingsAt("", 0)).toEqual([]);
  });
});
