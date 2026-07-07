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
 * Emits ``lambda-change`` with ``{ value: string }`` on every *user* doc
 * edit. Programmatic ``value``-prop syncs (see ``updated``) are tagged with
 * the ``externalSync`` annotation and skipped — otherwise re-pointing a
 * reused editor at a new field's body (e.g. a section switch driven by the
 * YAML pane's cursor) would echo a spurious ``lambda-change`` and dirty the
 * form with no user edit (#1223).
 */
import { indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { indentUnit } from "@codemirror/language";
import { Annotation, Compartment } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { consume } from "@lit/context";
import { basicSetup, EditorView } from "codemirror";
import { css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../../common/localize.js";
import { darkModeContext, localizeContext } from "../../../context/index.js";
import { editorHeightTheme, selectEditorTheme } from "../../../util/codemirror-theme.js";
import { initialDarkMode } from "../../../util/dark-mode.js";
import { editorSearchPhrases } from "../../../util/editor-search-phrases.js";
import { CodeMirrorEditorElement } from "../../codemirror-editor-element.js";

/** Marks the doc change that syncs the external ``value`` prop into the
 *  view, so the update listener can tell it apart from a user edit and
 *  not echo it back as a ``lambda-change``. */
const externalSync = Annotation.define<boolean>();

@customElement("esphome-lambda-editor")
export class ESPHomeLambdaEditor extends CodeMirrorEditorElement {
  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = initialDarkMode();

  // Not subscribed: phrases are captured at mount, so the panel localizes at mount only.
  @consume({ context: localizeContext })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property() value = "";

  // ``reflect: true`` so the ``:host([disabled]) .cm-wrap`` CSS
  // selector below actually matches — without reflection the
  // attribute isn't written to the host and the dimmed-state
  // styling never fires.
  @property({ type: Boolean, reflect: true }) disabled = false;

  @property({ type: Boolean }) invalid = false;

  @property() placeholder = "";

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
        effects: this._themeCompartment.reconfigure(selectEditorTheme(this._darkMode)),
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
          annotations: externalSync.of(true),
        });
      }
    }
  }

  private _mountEditor() {
    this._mountView(this.value, [
      basicSetup,
      editorSearchPhrases(this._localize),
      cpp(),
      indentUnit.of("  "),
      keymap.of([indentWithTab]),
      this._editableCompartment.of(EditorView.editable.of(!this.disabled)),
      this._themeCompartment.of(selectEditorTheme(this._darkMode)),
      editorHeightTheme,
      EditorView.updateListener.of((update) => {
        // Skip programmatic ``value``-prop syncs (tagged ``externalSync``);
        // only a real user edit should emit ``lambda-change`` (#1223).
        // Presence check, not truthiness, so the marker reads as "this is
        // a sync" regardless of the annotation's payload.
        if (
          update.docChanged &&
          !update.transactions.some((tr) => tr.annotation(externalSync) !== undefined)
        ) {
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
    ]);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-lambda-editor": ESPHomeLambdaEditor;
  }
}
