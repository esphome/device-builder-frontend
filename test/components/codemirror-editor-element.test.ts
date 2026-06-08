/**
 * @vitest-environment happy-dom
 *
 * Pins the shared CodeMirror host lifecycle: `_mountView` builds a live
 * EditorView into `.cm-wrap`, and `_destroyView` / `disconnectedCallback`
 * tear it down.
 */
import type { EditorView } from "@codemirror/view";
import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { afterEach, describe, expect, it } from "vitest";

import { CodeMirrorEditorElement } from "../../src/components/codemirror-editor-element.js";

@customElement("test-cm-editor")
class TestCmEditor extends CodeMirrorEditorElement {
  protected render() {
    return html`<div class="cm-wrap"></div>`;
  }

  protected firstUpdated() {
    this._mountView("hello\nworld\n", []);
  }

  get view(): EditorView | null {
    return this._view;
  }

  get container(): HTMLDivElement {
    return this._container;
  }

  destroyView(): void {
    this._destroyView();
  }

  remount(doc: string): void {
    this._mountView(doc, []);
  }
}

async function mount(): Promise<TestCmEditor> {
  const el = new TestCmEditor();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("CodeMirrorEditorElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts a live EditorView into .cm-wrap", async () => {
    const el = await mount();
    expect(el.view).not.toBeNull();
    expect(el.view!.state.doc.toString()).toBe("hello\nworld\n");
    expect(el.container.querySelector(".cm-editor")).not.toBeNull();
  });

  it("destroys the view and drops the handle on _destroyView", async () => {
    const el = await mount();
    el.destroyView();
    expect(el.view).toBeNull();
    expect(el.container.querySelector(".cm-editor")).toBeNull();
  });

  it("tears down the prior view when mounted again", async () => {
    const el = await mount();
    const first = el.view!;
    el.remount("again");
    expect(el.view).not.toBe(first);
    expect(el.view!.state.doc.toString()).toBe("again");
    // Old view torn down — only the new editor remains in the host.
    expect(el.container.querySelectorAll(".cm-editor").length).toBe(1);
  });

  it("tears the view down when disconnected", async () => {
    const el = await mount();
    el.remove();
    expect(el.view).toBeNull();
  });
});
