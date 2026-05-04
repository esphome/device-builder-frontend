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
import { ESPHOME_YAML_INDENT, esphomeYaml } from "../util/esphome-yaml-lang.js";
import { createBackendYamlLinter } from "../util/yaml-lint-backend.js";
import { createYamlCompletionSource } from "../util/yaml-completion.js";
import {
  sensitiveValueMaskExtension,
  setRevealSensitiveEffect,
} from "../util/yaml-sensitive-mask.js";
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

  /** When true, sensitive credential values (passwords, encryption
   *  keys, PSKs) render as plain text. Default false → values render
   *  as bullets, matching how `<esphome-password-input>` hides the
   *  same fields in the config-entry form. Distinct from ESPHome's
   *  `!secret`-tag handling — this only affects raw inline values. */
  @property({ type: Boolean }) revealSensitive = false;

  @query(".cm-wrap") private _container!: HTMLDivElement;

  private _view: EditorView | null = null;

  /** Last 1-indexed cursor line we emitted as `yaml-cursor-line`.
   *  We only emit on line transitions so a horizontal mouse / arrow
   *  movement inside the same line doesn't churn the page state. */
  private _lastReportedCursorLine = 0;

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
      indentUnit.of(ESPHOME_YAML_INDENT),
      keymap.of([indentWithTab]),
      highlightField,
      sensitiveValueMaskExtension(this.revealSensitive),
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
        // LOAD-BEARING ORDER: `yaml-change` MUST be dispatched
        // before `yaml-cursor-line` within a single update.
        // The page's `_onYamlChange` writes `_yaml` from the
        // detail; its `_onYamlCursorLine` then reads `_yaml` to
        // map the cursor's line to a section. A user pressing
        // Enter at end-of-line fires both branches in one
        // transaction (docChanged AND selectionSet) — if cursor
        // ran first, it would parse a stale `_yaml` that
        // doesn't yet contain the new line, and the section
        // attribution would either miss or pick the wrong
        // section. Don't reorder these `if` blocks. (See
        // `pages/device.ts:_onYamlCursorLine` for the
        // matching mention of this invariant.)
        if (update.docChanged) {
          this.dispatchEvent(
            new CustomEvent("yaml-change", {
              detail: { value: update.state.doc.toString() },
              bubbles: true,
              composed: true,
            }),
          );
        }
        // Cursor moved (click, arrow keys, find-jump). Emit the
        // 1-indexed line so the page can switch the visual
        // section editor to match. Throttle to line transitions:
        // moving within the same line is irrelevant for section
        // attribution, and emitting on every column change would
        // churn page state.
        if (update.selectionSet) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head).number;
          if (line !== this._lastReportedCursorLine) {
            this._lastReportedCursorLine = line;
            this.dispatchEvent(
              new CustomEvent("yaml-cursor-line", {
                detail: { line },
                bubbles: true,
                composed: true,
              }),
            );
          }
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

  /**
   * Tear down the current view and mount a fresh one against
   * `this.value`. Both rebuild branches in `updated()` (theme/API
   * change, configuration change) end with the same destroy +
   * clear + reset-throttle + remount sequence; without this
   * helper the throttle reset in particular tends to drift
   * across the two copies (forgetting to reset
   * `_lastReportedCursorLine` after a configuration change is
   * what regressed cross-device cursor dispatch — a host-side
   * field outliving the destroyed view).
   */
  private _remountEditor() {
    this._view!.destroy();
    this._container.innerHTML = "";
    this._lastReportedCursorLine = 0;
    this._mountEditor();
  }

  updated(changed: Map<string, unknown>) {
    // FIRST-MATCH-WINS: each branch below ends in `return` so a
    // single render cycle takes exactly one path through this
    // method. The same-document `value` branch is the fallthrough
    // for the common case (no rebuild needed). Adding a fourth
    // branch later? Preserve the early-return pattern — letting
    // the value-change branch fire after a destroy + remount
    // would dispatch a stale-cursor preservation against the
    // freshly-mounted view.

    // Theme / API changes require a full editor rebuild — CodeMirror
    // extensions are static once the state is built. The user may
    // have unsaved edits in the view that the parent's `value` prop
    // doesn't yet reflect (the parent only learns about edits via
    // `yaml-change`, which it loops back as `value`), so preserve
    // the current view content across the rebuild by writing it
    // back into `this.value` before remounting.
    if (
      (changed.has("_darkMode") || changed.has("_api")) &&
      this._view
    ) {
      this.value = this._view.state.doc.toString();
      this._remountEditor();
      return;
    }

    // Configuration change = different device. The `<esphome-
    // yaml-editor>` instance is reused across route changes, so
    // we have to actively reset the view (destroy + remount with
    // the parent's new `value`); skipping this would either keep
    // the previous device's content or run the same-document
    // preservation path below, which would map the prior file's
    // cursor offset onto the new file (very disorienting on
    // cross-device navigation). Initial cursor / scroll state is
    // owned by `_mountEditor` (offset 0, scroll top via
    // `EditorState.create`'s default selection), not this branch.
    if (changed.has("configuration") && this._view) {
      this._remountEditor();
      return;
    }

    if (changed.has("value") && this._view) {
      const current = this._view.state.doc.toString();
      if (current !== this.value) {
        // Same-document patch (section-editor save, …).
        //
        // The naive `from: 0, to: oldLen, insert: newText`
        // reframes the entire doc as one giant replace, which
        // (a) destroys CodeMirror's natural selection mapping
        // (the cursor maps to offset 0 — the left side of the
        // deletion's `assoc=-1` default) and (b) re-anchors
        // `scrollTop` to keep the cursor visible, throwing the
        // user back to the top of the YAML pane after a
        // section-editor save.
        //
        // Compute a minimal change instead: shave the longest
        // common prefix and suffix off both buffers and dispatch
        // only the middle slice. CodeMirror's transaction then
        // automatically maps the existing selection through that
        // change — a cursor *before* the change sticks to the
        // same offset (same line, same column); a cursor
        // *after* shifts by (insert.length - delete.length),
        // landing on the same logical line/column even when the
        // save inserts or removes lines above. Offset-only
        // preservation didn't have this property: a
        // section-editor save above the cursor would land the
        // caret on a different line in the new document.
        //
        // Scroll preservation stays separate — even with a
        // minimal change, CodeMirror can re-anchor scroll if
        // the selection mapping ends up "near" the visible
        // viewport edge, so we snapshot `scrollTop` and write
        // it back after the dispatch.
        //
        // Cross-device navigation skips this path via the
        // `configuration`-change branch above, so the
        // common-prefix logic only ever runs against doc pairs
        // that share most of their content (typical
        // section-save: one block changed, prefix+suffix
        // untouched).
        const view = this._view;
        const scrollTop = view.scrollDOM.scrollTop;
        const oldLen = current.length;
        const newLen = this.value.length;
        const minLen = Math.min(oldLen, newLen);
        let prefix = 0;
        while (prefix < minLen && current[prefix] === this.value[prefix]) {
          prefix++;
        }
        let suffix = 0;
        while (
          suffix < minLen - prefix &&
          current[oldLen - 1 - suffix] === this.value[newLen - 1 - suffix]
        ) {
          suffix++;
        }
        view.dispatch({
          changes: {
            from: prefix,
            to: oldLen - suffix,
            insert: this.value.slice(prefix, newLen - suffix),
          },
        });
        view.scrollDOM.scrollTop = scrollTop;
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

    if (changed.has("revealSensitive") && this._view) {
      this._view.dispatch({
        effects: setRevealSensitiveEffect.of(this.revealSensitive),
      });
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
