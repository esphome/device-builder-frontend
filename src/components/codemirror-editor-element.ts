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
 *
 * The view is torn down once the element is still detached at the next
 * microtask checkpoint and mounted again when it comes back; a synchronous
 * move (a keyed list reordering its rows) keeps its view, with its undo
 * history, cursor and selection.
 */
export abstract class CodeMirrorEditorElement extends LitElement {
  @query(".cm-wrap") protected _container!: HTMLDivElement;

  protected _view: EditorView | null = null;

  /** Mount the view from the element's current properties, resetting
   *  anything the subclass tracked about the previous view. */
  protected abstract _mountEditor(): void;

  protected firstUpdated(): void {
    this._mountEditor();
  }

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

  override connectedCallback(): void {
    super.connectedCallback();
    // Before the first render there is no host yet; firstUpdated mounts then.
    if (!this.hasUpdated) return;
    if (this._view) this._view.requestMeasure();
    else this._mountEditor();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    queueMicrotask(() => {
      if (!this.isConnected) this._destroyView();
    });
  }
}
