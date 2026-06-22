import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import { shouldIdleComplete } from "../../src/util/idle-completion.js";

function stateAt(doc: string, head = doc.length, anchor = head): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [esphomeYaml()],
  });
}

describe("shouldIdleComplete", () => {
  it("fires on a blank indented line at end of line", () => {
    expect(shouldIdleComplete(stateAt("esp32:\n  framework:\n    "))).toBe(true);
  });

  it("fires at an empty value (key: )", () => {
    expect(shouldIdleComplete(stateAt("esp32:\n  framework:\n    type: "))).toBe(true);
  });

  it("fires at a key partial", () => {
    expect(shouldIdleComplete(stateAt("esp32:\n  fra"))).toBe(true);
  });

  it("does not fire mid-line", () => {
    const doc = "esphome:\n  name: My Device";
    expect(shouldIdleComplete(stateAt(doc, doc.indexOf("My")))).toBe(false);
  });

  it("does not fire on a completed multi-word value", () => {
    expect(shouldIdleComplete(stateAt("esphome:\n  name: My Device"))).toBe(false);
  });

  it("does not fire inside a comment", () => {
    expect(shouldIdleComplete(stateAt("esp32:\n  # a comment"))).toBe(false);
  });

  it("does not fire with a non-empty selection", () => {
    const doc = "esp32:\n  framework:\n    ";
    expect(shouldIdleComplete(stateAt(doc, doc.length, doc.length - 4))).toBe(false);
  });
});
