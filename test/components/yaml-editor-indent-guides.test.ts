/**
 * @vitest-environment happy-dom
 *
 * Pins issue #1231: the editor draws indentation guide lines on
 * indented rows (the legacy editor's "column lines").
 */
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { ESPHomeYamlEditor } from "../../src/components/yaml-editor.js";

async function mount(): Promise<ESPHomeYamlEditor> {
  const el = new ESPHomeYamlEditor();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const viewOf = (el: ESPHomeYamlEditor): EditorView =>
  (el as unknown as { _view: EditorView })._view;

describe("yaml-editor indentation guides (#1231)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("marks indented lines with the indent-guide decoration", async () => {
    const el = await mount();
    el.value = "sensor:\n  - platform: dht\n    pin: D1\n";
    await el.updateComplete;

    const guided = viewOf(el).dom.querySelectorAll(".cm-line.cm-indent-markers");
    expect(guided.length).toBeGreaterThan(0);
  });

  it("does not mark the top-level (unindented) line", async () => {
    const el = await mount();
    el.value = "logger:\n  level: DEBUG\n";
    await el.updateComplete;

    const view = viewOf(el);
    const lines = view.dom.querySelectorAll(".cm-line");
    expect(lines[0]?.classList.contains("cm-indent-markers")).toBe(false);
  });
});
