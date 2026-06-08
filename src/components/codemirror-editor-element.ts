import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { LitElement } from "lit";
import { query } from "lit/decorators.js";

/**
 * Shared CodeMirror host scaffolding for the YAML and lambda editors.
 *
 * Owns only the genuinely identical lifecycle — the ``.cm-wrap`` host
 * lookup, the single ``EditorView`` handle, and its mount/teardown.
 * Subclasses keep their own styles, extensions, change events, and
 * theme/reconfigure strategy; the base never touches those.
 */
export abstract class CodeMirrorEditorElement extends LitElement {
  @query(".cm-wrap") protected _container!: HTMLDivElement;

  protected _view: EditorView | null = null;

  /** Build the view into ``.cm-wrap`` with the subclass's extensions;
   *  tears down any existing view first so the single-handle contract
   *  holds even if a subclass mounts twice. */
  protected _mountView(doc: string, extensions: Extension): void {
    this._destroyView();
    this._view = new EditorView({
      state: EditorState.create({ doc, extensions }),
      parent: this._container,
    });
  }

  /** Destroy the view and drop the handle. */
  protected _destroyView(): void {
    this._view?.destroy();
    this._view = null;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._destroyView();
  }
}
