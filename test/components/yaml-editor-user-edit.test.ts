/**
 * @vitest-environment happy-dom
 *
 * Pins `yaml-user-edit`: a user-driven doc change while a block highlight is
 * showing emits once so the page can drop the (now stale-ranged) highlight; a
 * programmatic doc sync, or an edit with no highlight active, emits nothing.
 */
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { ESPHomeYamlEditor } from "../../src/components/yaml-editor.js";

async function mount(value: string): Promise<ESPHomeYamlEditor> {
  const el = new ESPHomeYamlEditor();
  document.body.appendChild(el);
  await el.updateComplete; // mounts empty
  el.value = value; // content arrives async (baselined, no event)
  await el.updateComplete;
  return el;
}

const viewOf = (el: ESPHomeYamlEditor): EditorView =>
  (el as unknown as { _view: EditorView })._view;

/** Count every `yaml-user-edit` the editor emits from now on. */
function record(el: ESPHomeYamlEditor): { count: number } {
  const seen = { count: 0 };
  el.addEventListener("yaml-user-edit", () => {
    seen.count += 1;
  });
  return seen;
}

/** One keystroke: edit + caret move in a single user-annotated transaction. */
function typeAtEnd(view: EditorView, text: string) {
  const at = view.state.doc.length;
  view.dispatch({
    changes: { from: at, insert: text },
    selection: EditorSelection.single(at + text.length),
    userEvent: "input.type",
  });
}

describe("yaml-editor yaml-user-edit emission", () => {
  it("emits when the user types while a highlight is showing", async () => {
    const el = await mount("ota:\n  - platform: esphome\n");
    el.highlightRange = { fromLine: 1, toLine: 2 };
    await el.updateComplete;
    const seen = record(el);

    typeAtEnd(viewOf(el), "    id: ddd\n");

    expect(seen.count).toBe(1);
  });

  it("stops emitting once the page clears the highlight", async () => {
    const el = await mount("ota:\n  - platform: esphome\n");
    el.highlightRange = { fromLine: 1, toLine: 2 };
    await el.updateComplete;
    const seen = record(el);

    typeAtEnd(viewOf(el), "x");
    // The page reacts to the first emit by nulling the range.
    el.highlightRange = null;
    await el.updateComplete;
    typeAtEnd(viewOf(el), "y");

    expect(seen.count).toBe(1);
  });

  it("does not emit on a programmatic doc patch", async () => {
    const el = await mount("logger:\n  level: DEBUG\n");
    el.highlightRange = { fromLine: 1, toLine: 2 };
    await el.updateComplete;
    const seen = record(el);

    // A host `value`-prop sync dispatches changes with no userEvent
    // annotation — it must not clear a field-focus highlight.
    const view = viewOf(el);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "G" } });

    expect(seen.count).toBe(0);
  });

  it("emits for a single-line highlight too", async () => {
    // A single-line *section* highlight (a childless `api:` block) goes
    // half-stale the moment a child line is typed under it, so the editor
    // can't gate on range width; the page keeps error-jump highlights
    // alive via its `_errorHighlight` lifecycle instead.
    const el = await mount("logger:\n  level: DEBUG\n");
    el.highlightRange = { fromLine: 2, toLine: 2 };
    await el.updateComplete;
    const seen = record(el);

    typeAtEnd(viewOf(el), "x");

    expect(seen.count).toBe(1);
  });

  it("does not emit when no highlight is active", async () => {
    const el = await mount("logger:\n  level: DEBUG\n");
    const seen = record(el);

    typeAtEnd(viewOf(el), "x");

    expect(seen.count).toBe(0);
  });
});
