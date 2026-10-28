// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  findIncludeTargets,
  includeLinks,
  includePathAt,
  resolveIncludePath,
} from "../../src/util/yaml-include-links.js";

describe("findIncludeTargets", () => {
  it.each([
    ["  base: !include common/base.yaml", ["common/base.yaml"]],
    ['  base: !include "common/base.yaml"', ["common/base.yaml"]],
    ["  base: !include 'common/b.yml'", ["common/b.yml"]],
    ["  base: !include { file: common/base.yaml, vars: { a: 1 } }", ["common/base.yaml"]],
    ["<<: !include ../shared.yaml", ["../shared.yaml"]],
    ["wifi: !include wifi.yaml # !include other.yaml", ["wifi.yaml"]],
    ["# base: !include common/base.yaml", []],
    ["  base: !include ${dir}/base.yaml", []],
    ["  base: !include common/notes.txt", []],
    ["  base: github://esphome/firmware/x.yaml@main", []],
    ["  name: include_me.yaml", []],
  ])("%j → %j", (line, refs) => {
    expect(findIncludeTargets(line).map((t) => t.ref)).toEqual(refs);
  });

  it("reports the path's offsets within the line", () => {
    const line = '  base: !include "common/base.yaml"';
    const [t] = findIncludeTargets(line);
    expect(line.slice(t.from, t.to)).toBe("common/base.yaml");
  });
});

describe("resolveIncludePath", () => {
  it.each([
    ["kitchen.yaml", "common/base.yaml", "common/base.yaml"],
    ["common/base.yaml", "wifi.yaml", "common/wifi.yaml"],
    ["common/sensors/a.yaml", "../boards/b.yaml", "common/boards/b.yaml"],
    ["common/base.yaml", "./sub/x.yaml", "common/sub/x.yaml"],
    ["kitchen.yaml", "../outside.yaml", null],
    ["kitchen.yaml", "/etc/x.yaml", null],
    ["kitchen.yaml", "C:/x.yaml", null],
  ])("(%j, %j) → %j", (base, ref, expected) => {
    expect(resolveIncludePath(base, ref)).toBe(expected);
  });
});

describe("includePathAt", () => {
  const doc = "packages:\n  wifi: !include wifi.yaml\n  name: x\n";
  const view = new EditorView({ state: EditorState.create({ doc }) });
  const at = (needle: string, offset = 1) => doc.indexOf(needle) + offset;

  it("resolves the target under the position against the base file", () => {
    expect(includePathAt(view, at("wifi.yaml"), "common/base.yaml")).toBe(
      "common/wifi.yaml"
    );
  });

  it("is null off the path", () => {
    expect(includePathAt(view, at("!include"), "common/base.yaml")).toBeNull();
    expect(includePathAt(view, at("name"), "common/base.yaml")).toBeNull();
  });
});

describe("includeLinks modifier state", () => {
  it("marks the editor while Ctrl/Cmd is held and clears it on release or blur", () => {
    const view = new EditorView({
      state: EditorState.create({
        extensions: includeLinks(
          () => "a.yaml",
          () => {},
          ""
        ),
      }),
    });
    const held = () => view.dom.hasAttribute("data-include-mod");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
    expect(held()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    expect(held()).toBe(false);
    window.dispatchEvent(new MouseEvent("mousemove", { metaKey: true }));
    expect(held()).toBe(true);
    window.dispatchEvent(new Event("blur"));
    expect(held()).toBe(false);
    view.destroy();
    window.dispatchEvent(new KeyboardEvent("keydown", { ctrlKey: true }));
    expect(held()).toBe(false);
  });
});
