/**
 * @vitest-environment happy-dom
 *
 * Regression for #946: the structured editor follows the caret into a
 * block typed/completed on the current line. The editor emits
 * `yaml-cursor-line` on a line change OR a top-level-key change, so
 * turning a blank/partial line into `http_request:` re-attributes the
 * section even though the line number never changes.
 */
import { forceParsing } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { ESPHomeYamlEditor } from "../../src/components/yaml-editor.js";

interface CursorLineDetail {
  line: number;
  path: string[];
}

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

const parseAll = (view: EditorView) => forceParsing(view, view.state.doc.length, 60000);

/** Capture every `yaml-cursor-line` the editor emits from now on. */
function record(el: ESPHomeYamlEditor): CursorLineDetail[] {
  const seen: CursorLineDetail[] = [];
  el.addEventListener("yaml-cursor-line", (e) =>
    seen.push((e as CustomEvent<CursorLineDetail>).detail)
  );
  return seen;
}

const caretToLineEnd = (view: EditorView, line: number) =>
  view.dispatch({ selection: EditorSelection.single(view.state.doc.line(line).to) });

describe("yaml-editor cursor-line emission (#946)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("re-emits on a same-line top-level-key change (typing a new block)", async () => {
    // Line 3 starts blank; typing `http_request:` into it keeps line 3 but
    // changes the top-level key from none to http_request.
    const el = await mount("esp32:\n  board: a\n");
    const view = viewOf(el);
    parseAll(view);
    const events = record(el);

    // Caret rests on the blank top-level line 3 → first emit, no section.
    caretToLineEnd(view, 3);
    parseAll(view);
    expect(events).toHaveLength(1);
    expect(events[0].line).toBe(3);
    expect(events[0].path[0]).toBeUndefined();

    // Type the block header on the same line in one transaction — a real
    // keystroke carries both the edit and the caret move. The same-line
    // top-level-key change must still re-attribute the section.
    const at = view.state.doc.length;
    view.dispatch({
      changes: { from: at, insert: "http_request:" },
      selection: EditorSelection.single(at + "http_request:".length),
    });

    // One more emit, still line 3, now attributed to http_request.
    expect(events).toHaveLength(2);
    expect(events[1].line).toBe(3);
    expect(events[1].path[0]).toBe("http_request");
  });

  it("does not re-emit while typing within the same section", async () => {
    const el = await mount("logger:\n  level: DEBUG\n");
    const view = viewOf(el);
    parseAll(view);
    const events = record(el);

    // Settle on the value line → one emit under logger.
    caretToLineEnd(view, 2);
    parseAll(view);
    expect(events).toHaveLength(1);
    expect(events[0].path[0]).toBe("logger");

    // Keep typing in the same value in one transaction (edit + caret move):
    // same line, same top-level key.
    const at = view.state.doc.line(2).to;
    view.dispatch({
      changes: { from: at, insert: "X" },
      selection: EditorSelection.single(at + 1),
    });

    // No churn — the page already shows logger.
    expect(events).toHaveLength(1);
  });

  it("attributes an indented blank child line to its block (indent fallback)", async () => {
    // The AST yields no Pair on the blank line 4; the emitted path comes from
    // the caret's indentation so the page can follow the caret into the block.
    const el = await mount("esp32:\n  board: a\nhttp_request:\n  \n");
    const view = viewOf(el);
    parseAll(view);
    const events = record(el);

    caretToLineEnd(view, 4); // the "  " line under http_request
    expect(events).toHaveLength(1);
    expect(events[0].line).toBe(4);
    expect(events[0].path[0]).toBe("http_request");
  });

  it("does not emit on a programmatic doc patch with no selection", async () => {
    // A host `value`-prop sync into an unfocused split-view editor dispatches
    // a changes-only transaction (no selection). The gate is `selectionSet`
    // only, so it must not switch sections off the editor's stale caret.
    const el = await mount("logger:\n  level: DEBUG\n");
    const view = viewOf(el);
    parseAll(view);
    const events = record(el);

    const at = view.state.doc.line(2).to;
    view.dispatch({ changes: { from: at, insert: "G" } }); // no selection
    parseAll(view);
    expect(events).toHaveLength(0);
  });

  it("still emits on an ordinary line change", async () => {
    const el = await mount("esphome:\n  name: x\nlogger:\n  level: INFO\n");
    const view = viewOf(el);
    parseAll(view);
    const events = record(el);

    caretToLineEnd(view, 2); // esphome.name
    caretToLineEnd(view, 4); // logger.level
    expect(events).toHaveLength(2);
    expect(events[0].path[0]).toBe("esphome");
    expect(events[1].path[0]).toBe("logger");
  });
});
