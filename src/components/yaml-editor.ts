import { autocompletion, completionStatus } from "@codemirror/autocomplete";
import { indentWithTab, undoDepth } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { forceLinting } from "@codemirror/lint";
import { StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, keymap, tooltips, type DecorationSet } from "@codemirror/view";
import { consume } from "@lit/context";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { basicSetup, EditorView } from "codemirror";
import { css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { BoardCatalogEntry } from "../api/types/boards.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, darkModeContext, localizeContext } from "../context/index.js";
import {
  darkHighlight,
  EDITOR_BG_DARK,
  EDITOR_BG_LIGHT,
  EDITOR_FONT_FAMILY,
  EDITOR_FONT_SIZE,
  EDITOR_GUTTER_PADDING_LEFT,
  editorHeightTheme,
  INDENT_GUIDE_COLORS,
  lightHighlight,
  selectEditorTheme,
} from "../util/codemirror-theme.js";
import { initialDarkMode } from "../util/dark-mode.js";
import { editorSearchPhrases } from "../util/editor-search-phrases.js";
import { ESPHOME_YAML_INDENT, esphomeYaml } from "../util/esphome-yaml-lang.js";
import { idleCompletion } from "../util/idle-completion.js";
import { createYamlCompletionSource } from "../util/yaml-completion.js";
import { cursorKeyPathAt, indexedKeyPathAt } from "../util/yaml-cursor-paths.js";
import { lineKeyToken, type YamlAutoFix } from "../util/yaml-error-analysis.js";
import { createYamlHoverTooltip } from "../util/yaml-hover.js";
import { indentOf } from "../util/yaml-line-walker.js";
import {
  createBackendYamlLinter,
  lintErrorLineGutter,
  relintEffect,
  type YamlDiagnosticsDetail,
} from "../util/yaml-lint-backend.js";
import type { YamlSection } from "../util/yaml-sections.js";
import {
  sensitiveValueMaskExtension,
  setRevealSensitiveEffect,
} from "../util/yaml-sensitive-mask.js";
import { yamlStickyScroll } from "../util/yaml-sticky-scroll.js";
import { CodeMirrorEditorElement } from "./codemirror-editor-element.js";

export type HighlightRange = Pick<YamlSection, "fromLine" | "toLine">;

/** Result of an auto-fix attempt: applied, user-declined, a stale/no-target
 *  no-op (the doc shifted since the banner), or an unreachable defensive bail. */
export type AutoFixOutcome = "applied" | "declined" | "stale" | "unavailable";

// Delay before an at-rest caret opens the completion popup for discovery.
const IDLE_COMPLETION_DELAY_MS = 1500;

// `#` must be percent-encoded (`%23`) inside a data-URI background-image.
const errorDot = (fill: string, stroke: string): string =>
  `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">` +
  `<circle cx="20" cy="20" r="14" fill="${fill}" stroke="${stroke}" stroke-width="6"/></svg>')`;

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
        const lo = Math.max(1, fromLine);
        // A doc-shrinking `value` update can land in the same render cycle as
        // this highlight; if its start line no longer exists, drop it instead
        // of letting `doc.line()` throw on the stale number.
        if (lo > doc.lines) return Decoration.none;
        const hi = Math.min(doc.lines, toLine);
        // Single-line field highlight: a line decoration covers the whole line
        // regardless of content, so it doesn't lag behind text typed into the
        // line from the form. Multi-line section highlight: one mark spanning
        // the block, instead of a decoration per line for a large section.
        if (lo === hi) {
          return Decoration.set([
            Decoration.line({ class: "cm-esphome-highlight" }).range(doc.line(lo).from),
          ]);
        }
        const from = doc.line(lo).from;
        const to = doc.line(hi).to;
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
export class ESPHomeYamlEditor extends CodeMirrorEditorElement {
  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = initialDarkMode();

  @consume({ context: apiContext })
  @state()
  private _api?: ESPHomeAPI;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property() value = "";

  /**
   * Device configuration filename (e.g. "living-room.yaml"). Required for
   * backend-backed lint/completion to work — when empty, the editor falls
   * back to plain YAML editing with no diagnostics or suggestions.
   */
  @property() configuration = "";

  /**
   * The device's resolved board catalog entry. Supplies the target
   * platform/board so completion hydrates per-platform value options (e.g.
   * `hardware_uart`) the same way the structured editor does.
   */
  @property({ attribute: false }) board: BoardCatalogEntry | null = null;

  @property({ attribute: false }) highlightRange: HighlightRange | null = null;

  @property({ type: Boolean }) scrollToHighlight = false;

  /** When true, sensitive credential values (passwords, encryption
   *  keys, PSKs) render as plain text. Default false → values render
   *  as bullets, matching how `<esphome-password-input>` hides the
   *  same fields in the config-entry form. Distinct from ESPHome's
   *  `!secret`-tag handling — this only affects raw inline values. */
  @property({ type: Boolean }) revealSensitive = false;

  /** When true, EVERY key/value pair is masked — used by the
   *  `secrets.yaml` editor, where the entire file is by definition
   *  a list of credentials and the per-key allowlist (password,
   *  ota_password, encryption.key, …) doesn't apply. Captured at
   *  extension-construction time; runtime changes trigger an
   *  editor remount via `updated()` (same path dark-mode uses). */
  @property({ type: Boolean }) maskAllValues = false;

  /** Last 1-indexed cursor line we emitted as `yaml-cursor-line`.
   *  We only emit on line transitions so a horizontal mouse / arrow
   *  movement inside the same line doesn't churn the page state. */
  private _lastReportedCursorLine = 0;

  /** Joined key path last emitted with `yaml-cursor-line`. We re-emit when the
   *  resolved path changes — a different section OR a different field on the
   *  same line (typing/completing a new block, or moving between fields of a
   *  list item, where the line and top-level key stay put). Throttling on the
   *  whole path keeps both section- and field-following in sync without
   *  churning on plain column moves. */
  private _lastReportedPathKey = "";

  /** Last completion-popup visibility emitted as `yaml-completion-open`. */
  private _lastCompletionOpen = false;

  static styles = css`
    :host {
      display: block;
      position: relative;
      flex: 1;
      min-height: 0;
      /* Contain CodeMirror's internal z-indexes (search panel: 300) so they
         can't paint over action rows that host pages float above the editor. */
      isolation: isolate;
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
      editorSearchPhrases(this._localize),
      esphomeYaml(),
      indentUnit.of(ESPHOME_YAML_INDENT),
      keymap.of([indentWithTab]),
      // Vertical indentation guides. 'fullScope' carries the guide through
      // blank lines inside a block, matching the legacy editor's column
      // lines; pinned explicitly so a dependency default change can't alter
      // it.
      indentationMarkers({
        thickness: 1,
        highlightActiveBlock: true,
        markerType: "fullScope",
        colors: INDENT_GUIDE_COLORS,
      }),
      highlightField,
      // Keep every tooltip (lint hover, docs hover, completion) inside the
      // code pane: near the bottom they flip above the line instead of
      // spilling over the invalid banner / action row below the editor.
      tooltips({
        tooltipSpace: (view) => view.scrollDOM.getBoundingClientRect(),
      }),
      sensitiveValueMaskExtension(this.revealSensitive, this.maskAllValues),
      yamlStickyScroll({
        highlightStyle: this._darkMode ? darkHighlight : lightHighlight,
        background: this._darkMode ? EDITOR_BG_DARK : EDITOR_BG_LIGHT,
        jumpToLineLabel: (line) =>
          this._localize("yaml_editor.sticky_jump_to_line", { line: String(line) }),
      }),
      editorHeightTheme,
      EditorView.theme({
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: EDITOR_FONT_FAMILY,
          fontVariantLigatures: "none",
          fontSize: EDITOR_FONT_SIZE,
        },
        // Trim the CodeMirror default left inset so the line numbers hug the
        // pane edge instead of reading as extra left padding. The sticky-scroll
        // overlay measures this at runtime and mirrors it.
        ".cm-lineNumbers .cm-gutterElement": {
          paddingLeft: EDITOR_GUTTER_PADDING_LEFT,
        },
        ".cm-esphome-highlight": {
          background: this._darkMode
            ? "rgba(99, 179, 237, 0.2)"
            : "rgba(59, 130, 246, 0.1)",
        },
        // ─── Diagnostics: red wavy underline + gutter marker ────────
        ".cm-lintRange-error": {
          backgroundImage: this._darkMode
            ? 'url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6 3"><path d="M0 3 L1.5 0 L3 3 L4.5 0 L6 3" fill="none" stroke="%23ff6b6b" stroke-width="0.9" stroke-linecap="round"/></svg>\')'
            : 'url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6 3"><path d="M0 3 L1.5 0 L3 3 L4.5 0 L6 3" fill="none" stroke="%23d92d20" stroke-width="0.9" stroke-linecap="round"/></svg>\')',
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
          borderLeft: this._darkMode ? "3px solid #ff6b6b" : "3px solid #d92d20",
          background: "transparent",
          color: this._darkMode ? "#f0f0f5" : "#1a1a1a",
          fontFamily: "inherit",
          fontSize: "12.5px",
          fontWeight: "500",
          lineHeight: "1.5",
        },
        ".cm-diagnostic + .cm-diagnostic": {
          borderTop: this._darkMode ? "1px solid #2a2a32" : "1px solid #f0f1f3",
        },
        ".cm-diagnostic a.cm-diagnostic-link": {
          color: this._darkMode ? "#8cc2ff" : "#0b5cad",
          textDecoration: "underline",
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
        // A red dot replaces the line number on error lines — no separate
        // lint gutter, so an error never reflows the editor.
        ".cm-lineNumbers .cm-gutterElement.cm-lint-error-line": {
          color: "transparent",
          backgroundImage: this._darkMode
            ? errorDot("%23ff6b6b", "%23d92d20")
            : errorDot("%23d92d20", "%23a51d12"),
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 3px center",
          backgroundSize: "0.7em",
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
        ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
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
        ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionMatchedText": {
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
        // ─── Hover docs tooltip ─────────────────────────────────────
        ".cm-tooltip.cm-tooltip-hover": {
          background: this._darkMode ? "#1f1f23" : "#ffffff",
          border: this._darkMode ? "1px solid #3a3a44" : "1px solid #e1e4e8",
          borderRadius: "8px",
          boxShadow: this._darkMode
            ? "0 8px 24px rgba(0,0,0,0.5)"
            : "0 8px 24px rgba(0,0,0,0.12)",
          maxWidth: "460px",
        },
        ".cm-esphome-hover": {
          padding: "10px 14px",
          fontSize: "12.5px",
          lineHeight: "1.5",
          color: this._darkMode ? "#f0f0f5" : "#1a1a1a",
        },
        ".cm-esphome-hover p:last-child": {
          marginBottom: "0",
        },
        ".cm-esphome-hover .cm-esphome-info-meta": {
          fontStyle: "italic",
        },
        ".cm-esphome-info .md-code, .cm-esphome-hover .md-code": {
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: "0.92em",
          padding: "1px 4px",
          borderRadius: "4px",
          background: this._darkMode ? "#2a2a32" : "#f0f1f3",
        },
        ".cm-esphome-info .md-link, .cm-esphome-hover .md-link": {
          color: this._darkMode ? "#7fc4ff" : "#0b5cad",
          textDecoration: "underline",
        },
      }),
      EditorView.updateListener.of((update) => {
        // Surface completion-popup visibility so the host can hold the
        // invalid banner while the user is still picking an option.
        const completionOpen = completionStatus(update.state) === "active";
        if (completionOpen !== this._lastCompletionOpen) {
          this._lastCompletionOpen = completionOpen;
          this.dispatchEvent(
            new CustomEvent("yaml-completion-open", {
              detail: { open: completionOpen },
              bubbles: true,
              composed: true,
            })
          );
        }
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
            })
          );
          // A hand edit invalidates a block highlight: the stored
          // range is a static line snapshot and the mark decoration
          // only position-maps, so lines typed inside the section
          // fall outside it (a half-highlighted block). Gate on a
          // userEvent annotation (typing, paste, delete, undo, drag)
          // so programmatic doc syncs (the `value` prop, form-driven
          // splices) don't fire it. The page decides what actually
          // clears — an error-jump highlight follows its own
          // lint-driven lifecycle and survives, so emission can
          // repeat per keystroke while one is active.
          if (
            this.highlightRange !== null &&
            update.transactions.some(
              (tr) => tr.docChanged && tr.annotation(Transaction.userEvent) !== undefined
            )
          ) {
            this.dispatchEvent(
              new CustomEvent("yaml-user-edit", { bubbles: true, composed: true })
            );
          }
        }
        // Cursor moved (click, arrow keys, find-jump) or a user edit
        // moved it. Emit the 1-indexed line + key path so the page can
        // switch the visual section editor to match. Gate on
        // `selectionSet` only: every user edit (typing, completion
        // accept) also moves the caret, so this still catches them, but
        // a programmatic host doc patch (the `value` prop sync) carries
        // no selection and must not switch sections on an unfocused
        // editor. Throttle so a mere column move within the same line and
        // field is ignored, but emit whenever the resolved path changes —
        // a new section OR a new field on the same line (typing a block or
        // moving between a list item's fields).
        if (update.selectionSet) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head).number;
          // A pure horizontal move within an unchanged line can't change the
          // path (only a doc edit can), so skip the walk on same-line cursor
          // moves with no edit.
          if (line === this._lastReportedCursorLine && !update.docChanged) return;
          // Resolve the caret's key path field-first (the page derives the
          // form-relative path from it). The indent-walker/AST fallback
          // chain is shared with the URL deep-link load path.
          const path = cursorKeyPathAt(update.state, head);
          const pathKey = JSON.stringify(path);
          if (
            line !== this._lastReportedCursorLine ||
            pathKey !== this._lastReportedPathKey
          ) {
            this._lastReportedCursorLine = line;
            this._lastReportedPathKey = pathKey;
            this.dispatchEvent(
              new CustomEvent("yaml-cursor-line", {
                detail: {
                  line,
                  path,
                  // AST-only sibling of ``path`` carrying block-sequence
                  // list indices — what the automation editor needs to
                  // resolve a node inside a handler body.
                  indexedPath: indexedKeyPathAt(update.state, head),
                },
                bubbles: true,
                composed: true,
              })
            );
          }
        }
      }),
      selectEditorTheme(this._darkMode),
    ];

    if (this._api && this.configuration) {
      // `lintErrorLineGutter` reads the linter's diagnostics, so it must be
      // wired after `createBackendYamlLinter`.
      extensions.push(
        createBackendYamlLinter({
          api: this._api,
          getConfiguration: () => this.configuration,
          localize: this._localize,
          onResult: (errors, mapped, configuration) =>
            this.dispatchEvent(
              new CustomEvent<YamlDiagnosticsDetail>("yaml-diagnostics", {
                detail: { errors, mapped, configuration },
                bubbles: true,
                composed: true,
              })
            ),
          onAutoFix: (fix) =>
            this.dispatchEvent(
              new CustomEvent<{ fix: YamlAutoFix }>("yaml-auto-fix", {
                detail: { fix },
                bubbles: true,
                composed: true,
              })
            ),
        }),
        lintErrorLineGutter
      );
      // The device's platform/board, read per invocation so completion
      // and hover share the structured editor's hydrated-body cache bucket.
      const getDeviceTarget = () => ({
        platform: this.board?.esphome.platform,
        boardId: this.board?.id,
      });
      // Schema-driven completion off the components catalog.
      extensions.push(
        autocompletion({
          override: [createYamlCompletionSource(this._api, getDeviceTarget)],
          activateOnTyping: true,
          icons: true,
          closeOnBlur: true,
          maxRenderedOptions: 60,
          // Pin the option-docs panel beside the list, or flush below it
          // when the side lacks room — the default "narrow" placement lays
          // the panel over the options themselves.
          positionInfo: (view, list, option) => {
            const space = view.scrollDOM.getBoundingClientRect();
            const listW = list.right - list.left;
            if (space.right - list.right >= 320) {
              return {
                style: `top: ${Math.max(0, option.top - list.top)}px; left: ${listW}px`,
              };
            }
            return { style: `top: ${list.bottom - list.top}px; left: 0px` };
          },
        }),
        // Open the popup when the caret idles on a blank/empty line, so
        // keys/values are discoverable without typing a partial first.
        idleCompletion(IDLE_COMPLETION_DELAY_MS)
      );
      // Catalog-backed hover docs (description + "See also" link).
      extensions.push(
        createYamlHoverTooltip(
          this._api,
          () => this._localize("device.see_also"),
          getDeviceTarget
        )
      );
    }

    return extensions;
  }

  private _mountEditor() {
    this._mountView(this.value, this._buildExtensions());

    // Remount paths in updated() return before the highlightRange
    // branch, so re-apply a pending highlight (+ scroll) here.
    if (this.highlightRange) this._applyHighlight();
  }

  /**
   * Validate a proposed one-line auto-fix, then apply it. When the proposed
   * document validates cleanly the fix applies straight away; when errors
   * remain `confirm` decides whether to apply anyway. Applied as a real,
   * undoable transaction.
   *
   * The re-validation is the real safety net against a stale banner: the
   * `- <key>` re-check (before and after the async step) is a cheap filter,
   * but the key is often a shared token (`platform`), so validating the
   * proposed document is what actually catches fixing the wrong item or
   * double-fixing one already repaired. A validation failure rejects (the
   * caller surfaces it) rather than silently applying.
   */
  async applyAutoFix(
    fix: YamlAutoFix,
    confirm?: () => Promise<boolean>
  ): Promise<AutoFixOutcome> {
    const view = this._view;
    if (!view || !this._api || (fix.kind !== "dash-space" && fix.indent === 0)) {
      return "unavailable";
    }
    // Resolve the target only when the line the fix wants to edit is still
    // the line the analysis saw — same key, same indent — so a stale click
    // after edits shifted line numbers, or on a line the user already
    // repaired by hand, can't edit the wrong line. The check is structural
    // rather than a re-run of the analysis: the diagnosis can be anchored
    // on a different line than the one it repairs (a continuation error
    // blames the line below the pair that moves), so re-analyzing at the
    // fix line can't reproduce every shape.
    const targetFrom = (): number | null => {
      const doc = view.state.doc;
      if (fix.line < 1 || fix.line > doc.lines) return null;
      const t = doc.line(fix.line);
      if (lineKeyToken(t.text) !== fix.key || indentOf(t.text) !== fix.fromIndent) {
        return null;
      }
      // A dedent must have the spaces it wants to remove.
      if (fix.indent < 0 && fix.fromIndent + fix.indent < 0) return null;
      return t.from;
    };
    const from = targetFrom();
    if (from === null) return "stale";

    const doc = view.state.doc;
    // The dash-space repair inserts after the stuck dash; indent repairs
    // insert or remove leading spaces at the line start.
    const changeAt = (at: number): { from: number; to?: number; insert?: string } =>
      fix.kind === "dash-space"
        ? { from: at + fix.fromIndent + 1, insert: " " }
        : fix.indent > 0
          ? { from: at, insert: " ".repeat(fix.indent) }
          : { from: at, to: at - fix.indent };
    const change = changeAt(from);
    const proposed =
      doc.sliceString(0, change.from) +
      (change.insert ?? "") +
      doc.sliceString(change.to ?? change.from);
    // A validation failure propagates: don't apply blindly, and let the caller
    // surface it rather than swallowing the click.
    const res = await this._api.validateYaml(this.configuration, proposed);
    // Clean result → just do it; otherwise ask before applying over errors.
    const clean = !res.yaml_errors?.length && !res.validation_errors?.length;
    const proceed = clean || (await (confirm?.() ?? Promise.resolve(false)));
    if (!proceed) return "declined";

    // Re-resolve the target: the doc may have changed while we awaited.
    const settled = targetFrom();
    if (settled === null) return "stale";
    view.dispatch({
      changes: changeAt(settled),
      scrollIntoView: true,
    });
    view.focus();
    return "applied";
  }

  /** Set (or clear) the highlight mark and scroll it into view. */
  private _applyHighlight() {
    if (!this._view) return;
    this._view.dispatch({ effects: setHighlight.of(this.highlightRange) });
    if (!this.highlightRange || !this.scrollToHighlight) return;
    const line = Math.max(1, this.highlightRange.fromLine);
    const pos = this._view.state.doc.line(
      Math.min(line, this._view.state.doc.lines)
    ).from;
    // ``nearest`` scrolls only when the line is outside the viewport, so a
    // structured-editor field highlight doesn't jolt the YAML pane when the
    // line is already visible.
    this._view.dispatch({
      effects: EditorView.scrollIntoView(pos, { y: "nearest", yMargin: 50 }),
    });
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
    this._destroyView();
    this._container.innerHTML = "";
    this._lastReportedCursorLine = 0;
    this._lastReportedPathKey = "";
    // A remount destroys any open completion popup without a state
    // transition the update listener could see — emit the close ourselves
    // or the host would hold the invalid banner forever.
    if (this._lastCompletionOpen) {
      this._lastCompletionOpen = false;
      this.dispatchEvent(
        new CustomEvent("yaml-completion-open", {
          detail: { open: false },
          bubbles: true,
          composed: true,
        })
      );
    }
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

    // Theme / API / maskAllValues / locale changes require a full
    // editor rebuild — CodeMirror extensions are static once the state
    // is built, so the mask-all flag and the search-panel phrases facet
    // are captured at extension construction time. The user may have
    // unsaved edits in the
    // view that the parent's `value` prop doesn't yet reflect (the
    // parent only learns about edits via `yaml-change`, which it
    // loops back as `value`), so preserve the current view content
    // across the rebuild by writing it back into `this.value`
    // before remounting.
    if (
      (changed.has("_darkMode") ||
        changed.has("_api") ||
        changed.has("maskAllValues") ||
        changed.has("_localize")) &&
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
      // First population of a never-edited editor: remount so the async
      // value is the undo baseline, else Ctrl+Z unwinds to blank (#1150).
      // The undoDepth gate keeps later external repopulates (after the
      // user edits/clears) undoable.
      if (current === "" && this.value !== "" && undoDepth(this._view.state) === 0) {
        this._remountEditor();
        return;
      }
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
      this._applyHighlight();
    }

    if (changed.has("revealSensitive") && this._view) {
      this._view.dispatch({
        effects: setRevealSensitiveEffect.of(this.revealSensitive),
      });
    }
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("secrets-saved", this._onSecretsSaved);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("secrets-saved", this._onSecretsSaved);
  }

  // A secrets.yaml write doesn't change the editor doc, so the backend lint
  // result for the open device is stale (its squiggle outlives the now-defined
  // !secret). Force a re-validate; the relintEffect schedules the lint so
  // forceLinting can run it immediately on unchanged content.
  private _onSecretsSaved = () => {
    const view = this._view;
    if (!view) return;
    view.dispatch({ effects: relintEffect.of(null) });
    forceLinting(view);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-yaml-editor": ESPHomeYamlEditor;
  }
}
