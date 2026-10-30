// @vitest-environment happy-dom
import { codeFolding, foldEffect, forceParsing } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import {
  findIncludeTargets,
  includeLinks,
  includePathAt,
  resolveIncludePath,
} from "../../src/util/yaml-include-links.js";

const stateOf = (doc: string) => EditorState.create({ doc, extensions: esphomeYaml() });
const refs = (doc: string) => findIncludeTargets(stateOf(doc)).map((t) => t.ref);

describe("findIncludeTargets", () => {
  it.each([
    ["base: !include common/base.yaml", ["common/base.yaml"]],
    ['base: !include "common/base.yaml"', ["common/base.yaml"]],
    ["base: !include 'common/b.yml'", ["common/b.yml"]],
    ["base: !include { file: common/base.yaml, vars: { a: 1 } }", ["common/base.yaml"]],
    ["<<: !include ../shared.yaml", ["../shared.yaml"]],
    ["wifi: !include wifi.yaml # !include other.yaml", ["wifi.yaml"]],
    ["# base: !include common/base.yaml", []],
    ["base: !include ${dir}/base.yaml", []],
    ["base: !include common/notes.txt", []],
    ["base: github://esphome/firmware/x.yaml@main", []],
    ["name: include_me.yaml", []],
    ["base: !include common/base.yaml.backup", []],
    ["base: !include common/Base.YAML", ["common/Base.YAML"]],
    ['base: !include "\\u0062ase.yaml"', []],
    ["sensor: [!include common/uptime.yaml]", ["common/uptime.yaml"]],
    ["s: [!include a.yaml, !include b.yaml]", ["a.yaml", "b.yaml"]],
    ["b: !include { vars: { id: plug }, file: common/base.yaml }", ["common/base.yaml"]],
    [
      "b: !include { vars: { file: x.yaml }, file: common/base.yaml }",
      ["common/base.yaml"],
    ],
    [
      'b: !include {vars: {name: "Room #1"}, file: common/base.yaml}',
      ["common/base.yaml"],
    ],
    ["b: !include { vars: { file: x.yaml } }", []],
    ["p: {a: !include {file: a.yaml}, b: !include b.yaml}", ["a.yaml", "b.yaml"]],
    ['name: "see !include x.yaml"', []],
    ["on_boot:\n  - lambda: |-\n      // !include y.yaml", []],
    ["- !include ../x.yaml", ["../x.yaml"]],
  ])("%j → %j", (doc, expected) => {
    expect(refs(doc)).toEqual(expected);
  });

  it.each([
    ["b: !include\n  file: common/base.yaml", ["common/base.yaml"]],
    ['b: !include\n  file: "common/base.yaml"', ["common/base.yaml"]],
    ["b: !include  # shared\n  file: common/base.yaml", ["common/base.yaml"]],
    ["b: !include\n  vars: { id: plug }\n  file: common/base.yaml", ["common/base.yaml"]],
    [
      "b: !include\n  vars:\n    id: plug\n  # shared\n  file: common/base.yaml",
      ["common/base.yaml"],
    ],
    ["b: !include\n  vars:\n    file: x.yaml", []],
    ["b: other\n  file: common/base.yaml", []],
    ["b: !include\n  file: ${dir}/base.yaml", []],
  ])("block form %j → %j", (doc, expected) => {
    expect(refs(doc)).toEqual(expected);
  });

  it("reports the path's document offsets, inside the quotes", () => {
    const doc = 'a: 1\nbase: !include "common/base.yaml"';
    const [t] = findIncludeTargets(stateOf(doc));
    expect(doc.slice(t.from, t.to)).toBe("common/base.yaml");
  });

  it("only returns targets overlapping the range", () => {
    const doc = "a: !include a.yaml\nb: !include b.yaml";
    const state = stateOf(doc);
    const second = doc.indexOf("b.yaml");
    expect(findIncludeTargets(state, second, doc.length).map((t) => t.ref)).toEqual([
      "b.yaml",
    ]);
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
  const view = new EditorView({ state: stateOf(doc) });
  const at = (needle: string, offset = 1) => doc.indexOf(needle) + offset;

  it("resolves the target under the position against the base file", () => {
    expect(includePathAt(view, at("wifi.yaml"), "common/base.yaml")).toBe(
      "common/wifi.yaml"
    );
  });

  it("follows the block form across a blank line", () => {
    const block = "b: !include\n\n  file: common/base.yaml\n";
    const v = new EditorView({ state: stateOf(block) });
    expect(includePathAt(v, block.indexOf("common/") + 1, "kitchen.yaml")).toBe(
      "common/base.yaml"
    );
  });

  it("is null off the path", () => {
    expect(includePathAt(view, at("!include"), "common/base.yaml")).toBeNull();
    expect(includePathAt(view, at("name"), "common/base.yaml")).toBeNull();
  });
});

function withApplePlatform(run: () => void) {
  const original = Object.getOwnPropertyDescriptor(navigator, "userAgentData");
  Object.defineProperty(navigator, "userAgentData", {
    value: { platform: "macOS" },
    configurable: true,
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(navigator, "userAgentData", original);
    else Reflect.deleteProperty(navigator, "userAgentData");
  }
}

describe("includeLinks modifier state", () => {
  const linkedView = () =>
    new EditorView({
      state: EditorState.create({
        extensions: includeLinks(
          () => "a.yaml",
          () => {},
          ""
        ),
      }),
    });

  it("marks the editor while Ctrl is held and clears it on release or blur", () => {
    const view = linkedView();
    const held = () => view.dom.hasAttribute("data-include-mod");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
    expect(held()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    expect(held()).toBe(false);
    window.dispatchEvent(new MouseEvent("mousemove", { metaKey: true }));
    expect(held()).toBe(false);
    window.dispatchEvent(new MouseEvent("mousemove", { ctrlKey: true }));
    expect(held()).toBe(true);
    window.dispatchEvent(new Event("blur"));
    expect(held()).toBe(false);
    view.destroy();
    window.dispatchEvent(new KeyboardEvent("keydown", { ctrlKey: true }));
    expect(held()).toBe(false);
  });

  it("uses ⌘ on Apple platforms, where Ctrl+click is the context menu", () => {
    withApplePlatform(() => {
      const view = linkedView();
      const held = () => view.dom.hasAttribute("data-include-mod");
      window.dispatchEvent(new MouseEvent("mousemove", { ctrlKey: true }));
      expect(held()).toBe(false);
      window.dispatchEvent(new MouseEvent("mousemove", { metaKey: true }));
      expect(held()).toBe(true);
      view.destroy();
    });
  });
});

describe("includeLinks decorations", () => {
  it("decorates a line split by a fold once, in order", () => {
    // Only a large fold splits the line into two visible ranges.
    const filler = Array.from({ length: 400 }, (_, i) => `k${i}: v`).join(", ");
    const doc = `packages: {a: !include common/a.yaml, ${filler}, b: !include common/b.yaml}\n`;
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          esphomeYaml(),
          codeFolding(),
          includeLinks(
            () => "kitchen.yaml",
            () => {},
            "open"
          ),
        ],
      }),
    });
    const links = () => view.dom.querySelectorAll(".cm-include-link").length;
    expect(links()).toBe(1);
    // finishing the parse rebuilds the links the first pass couldn't reach
    forceParsing(view, doc.length);
    expect(links()).toBe(2);
    expect(() =>
      view.dispatch({
        effects: foldEffect.of({ from: doc.indexOf("k0"), to: doc.indexOf(" b:") }),
      })
    ).not.toThrow();
    expect(view.visibleRanges.length).toBe(2);
    expect(links()).toBe(2);
    view.destroy();
  });
});
