// @vitest-environment happy-dom
import { completionStatus, startCompletion } from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import { idleCompletion, shouldIdleComplete } from "../../src/util/idle-completion.js";

// Spy on startCompletion and make completionStatus controllable, so the timer
// tests can assert when the plugin would open the popup (and that an active
// popup cancels a pending timer) without standing up the completion machinery.
vi.mock("@codemirror/autocomplete", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/autocomplete")>();
  return {
    ...actual,
    startCompletion: vi.fn(() => true),
    completionStatus: vi.fn(actual.completionStatus),
  };
});

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

  it("does not fire at a key partial (typing already drives that)", () => {
    expect(shouldIdleComplete(stateAt("esp32:\n  fra"))).toBe(false);
  });

  it("does not fire on a chosen value (no re-pop after accepting)", () => {
    expect(shouldIdleComplete(stateAt("logger:\n  baud_rate: 115200"))).toBe(false);
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

describe("idleCompletion (timer)", () => {
  const spy = vi.mocked(startCompletion);
  const status = vi.mocked(completionStatus);
  const realStatus = status.getMockImplementation()!;
  beforeEach(() => {
    vi.useFakeTimers();
    spy.mockClear();
    status.mockImplementation(realStatus);
  });
  afterEach(() => {
    vi.useRealTimers();
    // ``view.destroy()`` leaves the mounted DOM node in ``document.body``;
    // clear it so editors don't accumulate and ``activeElement`` can't stay
    // on a stale node across tests (would make the focus checks flaky).
    document.body.replaceChildren();
  });

  // Blank indented line under a block; caret starts at column 0 so the first
  // dispatch is a real selection move (arms the timer). Mounted + focused so
  // the focus guard passes.
  const mkView = (focus = true) => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: "esp32:\n  framework:\n    ",
        selection: EditorSelection.single(0),
        extensions: [esphomeYaml(), idleCompletion(1000)],
      }),
    });
    if (focus) view.focus();
    return view;
  };
  const toEnd = (view: EditorView) =>
    view.dispatch({ selection: EditorSelection.single(view.state.doc.length) });

  it("opens the popup once after the idle delay", () => {
    const view = mkView();
    toEnd(view);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(spy).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it("debounces rapid updates into a single fire", () => {
    const view = mkView();
    toEnd(view);
    vi.advanceTimersByTime(600);
    view.dispatch({ selection: EditorSelection.single(view.state.doc.length - 1) });
    vi.advanceTimersByTime(600); // re-armed, not yet elapsed
    expect(spy).not.toHaveBeenCalled();
    view.dispatch({ selection: EditorSelection.single(view.state.doc.length) });
    vi.advanceTimersByTime(1000);
    expect(spy).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it("does not fire when the editor is not focused", () => {
    const view = mkView(false);
    view.contentDOM.blur();
    toEnd(view);
    vi.advanceTimersByTime(1000);
    expect(spy).not.toHaveBeenCalled();
    view.destroy();
  });

  it("clears the timer on destroy", () => {
    const view = mkView();
    toEnd(view);
    view.destroy();
    vi.advanceTimersByTime(1000);
    expect(spy).not.toHaveBeenCalled();
  });

  it("cancels a pending timer once a completion is active (no reopen after Esc)", () => {
    const view = mkView();
    toEnd(view); // armed while no popup is open
    status.mockReturnValue("active"); // popup opened
    view.dispatch({ selection: EditorSelection.single(view.state.doc.length - 1) });
    status.mockReturnValue(null); // dismissed with Esc (no doc/selection update)
    vi.advanceTimersByTime(2000);
    expect(spy).not.toHaveBeenCalled();
    view.destroy();
  });
});
