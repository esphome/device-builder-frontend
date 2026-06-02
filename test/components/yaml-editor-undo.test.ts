/**
 * @vitest-environment happy-dom
 *
 * Regression for #1150: the editor mounts empty (value defaults to "")
 * and the device YAML loads async afterwards. That first content load
 * must not be an undoable step, or Ctrl+Z unwinds the editor to blank.
 */
import { undoDepth } from "@codemirror/commands";
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
});
