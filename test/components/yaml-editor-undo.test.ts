/**
 * @vitest-environment happy-dom
 *
 * Regression for #1150: the editor mounts empty (value defaults to "")
 * and the device YAML loads async afterwards. That first content load
 * must not be an undoable step, or Ctrl+Z unwinds the editor to blank.
 */
import { undo, undoDepth } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ESPHomeYamlEditor } from "../../src/components/yaml-editor.js";

async function mount(): Promise<ESPHomeYamlEditor> {
  const el = new ESPHomeYamlEditor();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const viewOf = (el: ESPHomeYamlEditor): EditorView =>
  (el as unknown as { _view: EditorView })._view;

describe("yaml-editor undo baseline (#1150)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not record the initial async content load in undo history", async () => {
    const el = await mount(); // mounts with empty doc
    el.value = "wifi:\n  ssid: x\n"; // YAML arrives later
    await el.updateComplete;

    const view = viewOf(el);
    expect(view.state.doc.toString()).toBe("wifi:\n  ssid: x\n");
    // Loaded content is the baseline — nothing to undo back to (no blank).
    expect(undoDepth(view.state)).toBe(0);
  });

  it("keeps an external repopulate undoable after the user clears the doc", async () => {
    const el = await mount();
    el.value = "wifi:\n  ssid: x\n"; // initial load (baselined)
    await el.updateComplete;
    const view = viewOf(el);

    // User clears the editor themselves — recorded in history.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
    expect(view.state.doc.toString()).toBe("");
    expect(undoDepth(view.state)).toBeGreaterThan(0);

    // An external action (e.g. a dialog's yaml-draft) repopulates it.
    // History is non-empty, so this must NOT remount and wipe the undo
    // stack — the same view stays mounted and the change is undoable.
    el.value = "logger:\n";
    await el.updateComplete;
    expect(viewOf(el)).toBe(view); // not remounted
    expect(view.state.doc.toString()).toBe("logger:\n");
    expect(undoDepth(view.state)).toBeGreaterThan(0); // history preserved

    // And undo still works (no wiped stack).
    undo(view);
    expect(view.state.doc.toString()).not.toBe("logger:\n");
  });

  it("still scrolls to the highlight when value + highlightRange load in one cycle", async () => {
    const el = await mount(); // empty
    const spy = vi.spyOn(
      el as unknown as { _applyHighlight: () => void },
      "_applyHighlight"
    );

    // Deep-link load: page sets YAML, highlightRange and scrollToHighlight
    // together. The initial-load remount early-returns before the
    // highlightRange branch, so the scroll must run via _mountEditor.
    el.value = "a\nb\nc\nd\ne\n";
    el.highlightRange = { fromLine: 4, toLine: 4 };
    el.scrollToHighlight = true;
    await el.updateComplete;

    expect(viewOf(el).state.doc.toString()).toBe("a\nb\nc\nd\ne\n");
    expect(spy).toHaveBeenCalled();
  });

  it("drops a highlight whose start line outlives a doc-shrinking value update", async () => {
    const el = await mount();
    el.value = "a\nb\nc\nd\ne\nf\ng\n";
    el.highlightRange = { fromLine: 7, toLine: 7 };
    await el.updateComplete;
    const view = viewOf(el);

    // Doc shrinks below the highlighted line and a (now stale) highlight
    // re-applies in the same cycle — must not throw "Invalid line number".
    el.value = "a\nb\n";
    el.highlightRange = { fromLine: 7, toLine: 7 };
    await el.updateComplete;

    expect(view.state.doc.toString()).toBe("a\nb\n");
  });
});
