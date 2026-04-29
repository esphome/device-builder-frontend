import { consume } from "@lit/context";
import { autocompletion } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { StateEffect, StateField } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { Decoration, keymap, type DecorationSet } from "@codemirror/view";
import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import { apiContext, darkModeContext } from "../context/index.js";
import { esphomeYaml } from "../util/esphome-yaml-lang.js";
import { createBackendYamlLinter } from "../util/yaml-lint-backend.js";
import { createYamlCompletionSource } from "../util/yaml-completion.js";
import type { YamlSection } from "../util/yaml-sections.js";

export type HighlightRange = Pick<YamlSection, "fromLine" | "toLine">;

// Module-level singletons so they survive editor rebuilds
const setHighlight = StateEffect.define<HighlightRange | null>();

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlight)) {
        if (!effect.value) return Decoration.none;
        const { fromLine, toLine } = effect.value;
        const doc = tr.state.doc;
        const from = doc.line(Math.max(1, fromLine)).from;
        const to = doc.line(Math.min(doc.lines, toLine)).to;
        return Decoration.set([
          Decoration.mark({ class: "cm-esphome-highlight" }).range(from, to),
        ]);
      }
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

@customElement("esphome-yaml-editor")
export class ESPHomeYamlEditor extends LitElement {
  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = false;

  @consume({ context: apiContext })
  @state()
  private _api?: ESPHomeAPI;

  @property() value = "";

  /**
   * Device configuration filename (e.g. "living-room.yaml"). Required for
   * backend-backed lint/completion to work — when empty, the editor falls
   * back to plain YAML editing with no diagnostics or suggestions.
   */
  @property() configuration = "";

  @property({ attribute: false }) highlightRange: HighlightRange | null = null;

  @property({ type: Boolean }) scrollToHighlight = false;

  @query(".cm-wrap") private _container!: HTMLDivElement;

  private _view: EditorView | null = null;

  static styles = css`
    :host {
      display: block;
      position: relative;
      flex: 1;
      min-height: 0;
    }

    .cm-wrap {
      position: absolute;
      inset: 0;
    }
  `;

  protected render() {
    return html`<div class="cm-wrap"></div>`;
  }

  protected firstUpdated() {
    this._mountEditor();
  }

  private _buildExtensions() {
    const extensions = [
      basicSetup,
      esphomeYaml(),
      indentUnit.of("  "),
      keymap.of([indentWithTab]),
      highlightField,
      EditorView.theme({
        "&": { height: "100%" },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: "13px",
        },
        ".cm-esphome-highlight": {
          background: this._darkMode
            ? "rgba(99, 179, 237, 0.2)"
            : "rgba(59, 130, 246, 0.1)",
        },
        // ─── Diagnostics: red wavy underline only (no gutter pill) ──
        ".cm-lintRange-error": {
          backgroundImage: this._darkMode
            ? "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 6 3\"><path d=\"M0 3 L1.5 0 L3 3 L4.5 0 L6 3\" fill=\"none\" stroke=\"%23ff6b6b\" stroke-width=\"0.9\" stroke-linecap=\"round\"/></svg>')"
            : "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 6 3\"><path d=\"M0 3 L1.5 0 L3 3 L4.5 0 L6 3\" fill=\"none\" stroke=\"%23d92d20\" stroke-width=\"0.9\" stroke-linecap=\"round\"/></svg>')",
          backgroundRepeat: "repeat-x",
          backgroundPosition: "left bottom",
          backgroundSize: "6px 3px",
          paddingBottom: "1px",
        },
        ".cm-tooltip.cm-tooltip-lint": {
          background: this._darkMode ? "#1f1f23" : "#ffffff",
          border: this._darkMode ? "1px solid #3a3a44" : "1px solid #e1e4e8",
          borderRadius: "8px",
          boxShadow: this._darkMode
            ? "0 8px 24px rgba(0,0,0,0.5)"
            : "0 8px 24px rgba(0,0,0,0.12)",
          padding: "0",
          maxWidth: "420px",
          overflow: "hidden",
        },
        ".cm-diagnostic": {
          padding: "10px 14px 10px 12px",
          borderLeft: this._darkMode
            ? "3px solid #ff6b6b"
            : "3px solid #d92d20",
          background: "transparent",
          color: this._darkMode ? "#f0f0f5" : "#1a1a1a",
          fontFamily: "inherit",
          fontSize: "12.5px",
          lineHeight: "1.5",
        },
        ".cm-diagnostic + .cm-diagnostic": {
          borderTop: this._darkMode ? "1px solid #2a2a32" : "1px solid #f0f1f3",
        },
        ".cm-diagnostic-error": {
          borderLeftColor: this._darkMode ? "#ff6b6b" : "#d92d20",
        },
        ".cm-diagnostic-warning": {
          borderLeftColor: this._darkMode ? "#ffb86c" : "#dc6803",
        },
        ".cm-diagnostic-info": {
          borderLeftColor: this._darkMode ? "#4dabf7" : "#0b5cad",
        },
        // ─── Autocompletion popup ───────────────────────────────────
        ".cm-tooltip.cm-tooltip-autocomplete": {
          background: this._darkMode ? "#1f1f23" : "#ffffff",
          border: this._darkMode ? "1px solid #3a3a44" : "1px solid #e1e4e8",
          borderRadius: "8px",
          boxShadow: this._darkMode
            ? "0 8px 24px rgba(0,0,0,0.5)"
            : "0 6px 20px rgba(0,0,0,0.1)",
          padding: "4px",
          fontFamily: "inherit",
        },
        ".cm-tooltip-autocomplete > ul": {
          fontFamily: "inherit",
          fontSize: "12.5px",
          maxHeight: "320px",
        },
        ".cm-tooltip-autocomplete > ul > li": {
          padding: "6px 10px 6px 8px",
          borderRadius: "5px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          color: this._darkMode ? "#e7e7ec" : "#1f2328",
        },
        ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
          background: this._darkMode ? "#2c5fb3" : "#0b5cad",
          color: "#ffffff",
        },
        ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail":
          {
            color: "rgba(255,255,255,0.78)",
          },
        ".cm-completionLabel": {
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: "12.5px",
          flex: "0 0 auto",
        },
        ".cm-completionMatchedText": {
          textDecoration: "none",
          fontWeight: "700",
          color: this._darkMode ? "#7fc4ff" : "#0b5cad",
        },
        ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionMatchedText":
          {
            color: "#ffffff",
            textShadow: "0 0 0.5px currentColor",
          },
        ".cm-completionDetail": {
          fontStyle: "normal",
          fontSize: "11px",
          color: this._darkMode ? "#9aa0a6" : "#5e6772",
          marginLeft: "auto",
          paddingLeft: "12px",
          flex: "0 0 auto",
        },
        ".cm-completionIcon": {
          width: "14px",
          fontSize: "12px",
          opacity: "0.85",
          textAlign: "center",
          flex: "0 0 14px",
        },
        ".cm-completionIcon-class": { color: this._darkMode ? "#ffd43b" : "#b08800" },
        ".cm-completionIcon-property": { color: this._darkMode ? "#7fc4ff" : "#0b5cad" },
        ".cm-completionIcon-constant": { color: this._darkMode ? "#a78bfa" : "#7c3aed" },
        ".cm-completionIcon-enum": { color: this._darkMode ? "#34d399" : "#0e7c4a" },
        ".cm-completionIcon-namespace": { color: this._darkMode ? "#fb923c" : "#c2410c" },
        ".cm-completionIcon-function": { color: this._darkMode ? "#f472b6" : "#be185d" },
        ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionIcon": {
          color: "#ffffff",
        },
        // Info card shown when an item is highlighted.
        ".cm-completionInfo": {
          marginLeft: "6px",
          background: this._darkMode ? "#1f1f23" : "#ffffff",
          border: this._darkMode ? "1px solid #3a3a44" : "1px solid #e1e4e8",
          borderRadius: "8px",
          padding: "10px 12px",
          maxWidth: "320px",
          fontSize: "12px",
          lineHeight: "1.5",
          color: this._darkMode ? "#e7e7ec" : "#1f2328",
          boxShadow: this._darkMode
            ? "0 8px 20px rgba(0,0,0,0.4)"
            : "0 6px 16px rgba(0,0,0,0.08)",
        },
        ".cm-esphome-info p": {
          margin: "0 0 6px 0",
        },
        ".cm-esphome-info-meta": {
          fontSize: "11px",
          color: this._darkMode ? "#9aa0a6" : "#5e6772",
          marginTop: "4px",
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          this.dispatchEvent(
            new CustomEvent("yaml-change", {
              detail: { value: update.state.doc.toString() },
              bubbles: true,
              composed: true,
            }),
          );
        }
      }),
      ...(this._darkMode ? [oneDark] : []),
    ];

    if (this._api && this.configuration) {
      // Backend lint — wavy underlines only, no gutter pill.
      extensions.push(
        createBackendYamlLinter({
          api: this._api,
          getConfiguration: () => this.configuration,
        }),
      );
      // Schema-driven completion off the components catalog.
      extensions.push(
        autocompletion({
          override: [createYamlCompletionSource(this._api)],
          activateOnTyping: true,
          icons: true,
          closeOnBlur: true,
          maxRenderedOptions: 60,
        }),
      );
    }

    return extensions;
  }

  private _mountEditor() {
    this._view = new EditorView({
      state: EditorState.create({
        doc: this.value,
        extensions: this._buildExtensions(),
      }),
      parent: this._container,
    });

    // Apply any pending highlight after mount
    if (this.highlightRange) {
      this._view.dispatch({ effects: setHighlight.of(this.highlightRange) });
    }
  }

  updated(changed: Map<string, unknown>) {
    // Theme or API/configuration changes require a full editor rebuild —
    // CodeMirror extensions are static once the state is built.
    if (
      (changed.has("_darkMode") ||
        changed.has("_api") ||
        changed.has("configuration")) &&
      this._view
    ) {
      const doc = this._view.state.doc.toString();
      this._view.destroy();
      this._container.innerHTML = "";
      this.value = doc;
      this._mountEditor();
      return;
    }

    if (changed.has("value") && this._view) {
      const current = this._view.state.doc.toString();
      if (current !== this.value) {
        this._view.dispatch({
          changes: { from: 0, to: current.length, insert: this.value },
        });
      }
    }

    if (changed.has("highlightRange") && this._view) {
      this._view.dispatch({ effects: setHighlight.of(this.highlightRange) });
      if (this.highlightRange && this.scrollToHighlight) {
        const line = Math.max(1, this.highlightRange.fromLine);
        const pos = this._view.state.doc.line(Math.min(line, this._view.state.doc.lines)).from;
        this._view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 50 }) });
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._view?.destroy();
    this._view = null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-yaml-editor": ESPHomeYamlEditor;
  }
}
