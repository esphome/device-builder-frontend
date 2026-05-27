/**
 * Inline CodeMirror C++ editor for ``!lambda`` field bodies.
 *
 * Renders a small editor for the C++ body only — the ``!lambda |- ``
 * tag prefix is added when the value is serialised to YAML and never
 * appears in the editor. ``@codemirror/lang-cpp`` is already wired
 * into the larger YAML editor (``util/esphome-yaml-lang.ts``) for the
 * mixed-language overlay; reusing it here keeps the highlighting
 * consistent between the two surfaces.
 *
 * Emits ``lambda-change`` with ``{ value: string }`` on every doc edit.
 */
import { consume } from "@lit/context";
import { cpp } from "@codemirror/lang-cpp";
import { indentUnit } from "@codemirror/language";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { basicSetup, EditorView } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";

import { darkModeContext } from "../../../context/index.js";
import { vscodeDark, vscodeLight } from "../../../util/yaml-editor-theme.js";

@customElement("esphome-lambda-editor")
export class ESPHomeLambdaEditor extends LitElement {
  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = false;

  @property() value = "";

  // ``reflect: true`` so the ``:host([disabled]) .cm-wrap`` CSS
  // selector below actually matches — without reflection the
  // attribute isn't written to the host and the dimmed-state
  // styling never fires.
  @property({ type: Boolean, reflect: true }) disabled = false;

  @property({ type: Boolean }) invalid = false;

  @property() placeholder = "";

  @query(".cm-wrap") private _container!: HTMLDivElement;

  private _view: EditorView | null = null;
  private _themeCompartment = new Compartment();
  private _editableCompartment = new Compartment();

  static styles = css`
    :host {
      display: block;
    }
    .cm-wrap {
      border: 1px solid var(--wa-color-neutral-border-quiet, #d1d5db);
      border-radius: 6px;
      overflow: hidden;
      min-height: 96px;
    }
    .cm-wrap.invalid {
      border-color: var(--wa-color-danger-fill-loud, #d92d20);
    }
    :host([disabled]) .cm-wrap {
      opacity: 0.6;
    }
    .cm-editor {
      font-family: "JetBrains Mono", "Fira Code", monospace;
      font-size: 13px;
      min-height: 96px;
      max-height: 320px;
    }
    .cm-editor .cm-scroller {
      overflow: auto;
    }
    .cm-editor.cm-focused {
      outline: 2px solid var(--wa-color-brand-fill-loud, #0b5cad);
      outline-offset: -1px;
    }
  `;

  protected render() {
    return html`<div class="cm-wrap ${this.invalid ? "invalid" : ""}"></div>`;
  }

  protected firstUpdated() {
    this._mountEditor();
  }

  protected updated(changed: Map<string, unknown>) {
    if (!this._view) return;
    if (changed.has("_darkMode")) {
      this._view.dispatch({
        effects: this._themeCompartment.reconfigure(
          this._darkMode ? vscodeDark : vscodeLight
        ),
      });
    }
    if (changed.has("disabled")) {
      this._view.dispatch({
        effects: this._editableCompartment.reconfigure(
          EditorView.editable.of(!this.disabled)
        ),
      });
    }
    if (changed.has("value")) {
      const current = this._view.state.doc.toString();
      if (current !== this.value) {
        this._view.dispatch({
          changes: { from: 0, to: current.length, insert: this.value },
        });
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._view?.destroy();
    this._view = null;
  }

  private _mountEditor() {
    this._view = new EditorView({
      state: EditorState.create({
        doc: this.value,
        extensions: [
          basicSetup,
          cpp(),
          indentUnit.of("  "),
          keymap.of([indentWithTab]),
          this._editableCompartment.of(EditorView.editable.of(!this.disabled)),
          this._themeCompartment.of(this._darkMode ? vscodeDark : vscodeLight),
          EditorView.theme({
            "&": { height: "100%" },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const value = update.state.doc.toString();
              this.dispatchEvent(
                new CustomEvent("lambda-change", {
                  detail: { value },
                  bubbles: true,
                  composed: true,
                })
              );
            }
          }),
        ],
      }),
      parent: this._container,
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-lambda-editor": ESPHomeLambdaEditor;
  }
}
