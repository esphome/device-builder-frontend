/**
 * @vitest-environment happy-dom
 *
 * Pins the always-on section markers: every top-level section header carries
 * its domain glyph (the same one the navigator row shows), independent of any
 * selection, and the set tracks doc edits.
 */
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { ESPHomeYamlEditor } from "../../src/components/yaml-editor.js";

const YAML = [
  "esphome:",
  "  name: x",
  "wifi:",
  "  ssid: y",
  "switch:",
  "  - platform: gpio",
  "",
].join("\n");

async function mount(value: string): Promise<ESPHomeYamlEditor> {
  const el = new ESPHomeYamlEditor();
  document.body.appendChild(el);
  await el.updateComplete;
  el.value = value;
  await el.updateComplete;
  return el;
}

const viewOf = (el: ESPHomeYamlEditor): EditorView =>
  (el as unknown as { _view: EditorView })._view;

/** Glyph per marker: the mdi ``name``, or ``logo:esphome`` for the core
 *  section's brand mark (which uses ``src`` rather than a library glyph). */
function markerGlyphs(el: ESPHomeYamlEditor): string[] {
  return Array.from(
    viewOf(el).dom.querySelectorAll<HTMLElement>(".cm-section-marker")
  ).map((m) => {
    const name = m.getAttribute("name");
    if (name) return name;
    return m.getAttribute("src")?.includes("esphome-mono") ? "logo:esphome" : "";
  });
}

describe("yaml-editor section markers", () => {
  it("marks every top-level section header with its domain glyph", async () => {
    const el = await mount(YAML);
    // esphome → brand logo, wifi → wifi, switch → toggle-switch-outline.
    expect(markerGlyphs(el)).toEqual(["logo:esphome", "wifi", "toggle-switch-outline"]);
  });

  it("shows markers with no selection active", async () => {
    const el = await mount(YAML);
    expect(el.highlightRange).toBeNull();
    expect(markerGlyphs(el)).toHaveLength(3);
  });

  it("tracks a section added by editing the doc", async () => {
    const el = await mount(YAML);
    const view = viewOf(el);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "logger:\n" },
    });
    await el.updateComplete;
    expect(markerGlyphs(el)).toEqual([
      "logo:esphome",
      "wifi",
      "toggle-switch-outline",
      "card-text-outline",
    ]);
  });
});
