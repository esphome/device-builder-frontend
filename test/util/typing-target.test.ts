// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { isTypingTarget } from "../../src/util/typing-target.js";

function el(tag: string): HTMLElement {
  return document.createElement(tag);
}

describe("isTypingTarget", () => {
  it("is false for undefined", () => {
    expect(isTypingTarget(undefined)).toBe(false);
  });

  it("is true for form fields", () => {
    expect(isTypingTarget(el("input"))).toBe(true);
    expect(isTypingTarget(el("textarea"))).toBe(true);
    expect(isTypingTarget(el("select"))).toBe(true);
  });

  it("is true for contentEditable surfaces", () => {
    const div = el("div");
    div.contentEditable = "true";
    document.body.append(div);
    expect(isTypingTarget(div)).toBe(true);
    div.remove();
  });

  it("is false for plain elements", () => {
    expect(isTypingTarget(el("div"))).toBe(false);
    expect(isTypingTarget(el("button"))).toBe(false);
  });

  it("is true anywhere inside the YAML editor's light DOM", () => {
    const editor = el("esphome-yaml-editor");
    const inner = el("div");
    editor.append(inner);
    expect(isTypingTarget(inner)).toBe(true);
  });

  it("hops shadow boundaries up to the YAML editor host", () => {
    const editor = el("esphome-yaml-editor");
    const shadow = editor.attachShadow({ mode: "open" });
    const cmHost = el("div");
    const caret = el("div");
    cmHost.append(caret);
    shadow.append(cmHost);
    expect(isTypingTarget(caret)).toBe(true);
  });

  it("is false inside an unrelated shadow root", () => {
    const host = el("some-other-element");
    const shadow = host.attachShadow({ mode: "open" });
    const inner = el("div");
    shadow.append(inner);
    expect(isTypingTarget(inner)).toBe(false);
  });
});
