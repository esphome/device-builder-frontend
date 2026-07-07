/**
 * @vitest-environment happy-dom
 *
 * The banner's one-click indentation auto-fix inserts N spaces at the start
 * of a `- ` list-item line so its `- ` marker lines up with the properties
 * it wrongly swallowed. Guarded against a line that is no longer a list item
 * (the banner can be a lint pass behind the buffer). Issue device-builder#1884.
 */
import { undo, undoDepth } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { ESPHomeYamlEditor } from "../../src/components/yaml-editor.js";
import { mount } from "../_dom.js";

const viewOf = (el: ESPHomeYamlEditor): EditorView =>
  (el as unknown as { _view: EditorView })._view;

// The reproduction: dash at column 0, properties indented 4 spaces.
const BROKEN = "sensor:\n- platform: dht\n    model: DHT11\n";

describe("yaml-editor applyIndentFix (#1884)", () => {
  it("indents the list-item marker so it lines up with its properties", async () => {
    const el = await mount(new ESPHomeYamlEditor());
    el.value = BROKEN;
    await el.updateComplete;
    const view = viewOf(el);

    el.applyIndentFix(2, 2); // indent line 2 by 2 spaces

    expect(view.state.doc.toString()).toBe(
      "sensor:\n  - platform: dht\n    model: DHT11\n"
    );
    // Applied as a real transaction, so the user can undo it.
    expect(undoDepth(view.state)).toBeGreaterThan(0);
    undo(view);
    expect(view.state.doc.toString()).toBe(BROKEN);
  });

  it("no-ops when the target line is no longer a list item (stale banner)", async () => {
    const el = await mount(new ESPHomeYamlEditor());
    el.value = "esphome:\n  name: x\n";
    await el.updateComplete;
    const view = viewOf(el);

    el.applyIndentFix(2, 2); // line 2 is `  name: x`, not a `- ` item

    expect(view.state.doc.toString()).toBe("esphome:\n  name: x\n");
    expect(undoDepth(view.state)).toBe(0);
  });

  it("no-ops for an out-of-range line or non-positive indent", async () => {
    const el = await mount(new ESPHomeYamlEditor());
    el.value = BROKEN;
    await el.updateComplete;
    const view = viewOf(el);

    el.applyIndentFix(99, 2); // past EOF
    el.applyIndentFix(2, 0); // nothing to insert

    expect(view.state.doc.toString()).toBe(BROKEN);
    expect(undoDepth(view.state)).toBe(0);
  });
});
