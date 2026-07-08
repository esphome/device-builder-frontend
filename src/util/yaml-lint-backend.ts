/**
 * CodeMirror linter backed by the dashboard's `editor/validate_yaml` API.
 *
 * Pipes the editor's current YAML through the upstream `esphome vscode --ace`
 * subprocess and converts the resulting `{yaml_errors, validation_errors}`
 * payload into CodeMirror `Diagnostic[]`. Validation errors carry a 0-indexed
 * `range` we can map directly; YAML parse errors only carry a message — the
 * shared analysis in `yaml-error-analysis.ts` extracts the position and
 * humanizes the text (the save-time prompt reuses the same functions).
 *
 * Wired via `linter()` (no `lintGutter()` — diagnostics show as red wavy
 * underlines only, never as a round pill in the gutter).
 */
import { forEachDiagnostic, linter, type Diagnostic } from "@codemirror/lint";
import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type RangeSet,
  type Text,
} from "@codemirror/state";
import { gutterLineClass, GutterMarker, type EditorView } from "@codemirror/view";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { EditorValidateResponse } from "../api/types/editor.js";
import type { LocalizeFunc } from "../common/localize.js";
import { formRelativePath } from "./backend-field-errors.js";
import { splitTextLinks } from "./markdown.js";
import { getKeyPathWithListIndices } from "./yaml-ast.js";
import {
  describeValueTypeCause,
  describeYamlError,
  parseYamlErrorPosition,
  sanitizeMessage,
  type ReadLine,
  type YamlAutoFix,
} from "./yaml-error-analysis.js";
import { indentOf } from "./yaml-line-walker.js";
import { isOpenConfigFile } from "./yaml-validation-summary.js";

/** A validation error resolved to a key chain in the open document. */
export interface MappedValidationError {
  message: string;
  /** 1-indexed line where the error's own range starts — inside the
   *  errored node, not the retargeted squiggle position, so list-item
   *  errors resolve to the right instance. */
  line: number;
  /** Key chain from the top-level section key down to the errored field;
   *  block-sequence items contribute their numeric index. */
  keyPath: (string | number)[];
}

/** A banner-bound error, optionally carrying a line so the banner can jump to it. */
export interface BannerError {
  message: string;
  /** 1-indexed line of a locatable YAML parse error, for the "go to line" jump. */
  line?: number;
  /** A one-click indentation repair, when the error can be fixed deterministically. */
  fix?: YamlAutoFix;
  /** What produced it: a YAML parse failure (often a half-typed token, so
   *  the banner damps its reveal while the user types) or a validation
   *  error on a parseable config (real breakage — reveal right away). */
  kind: "parse" | "validation";
}

/** Detail payload of the yaml-diagnostics event the editor re-emits. */
export interface YamlDiagnosticsDetail {
  /** Banner material: errors with no form field to carry their message. */
  errors: BannerError[];
  /** Errors resolved to a key path, for form fields and navigator badges. */
  mapped: MappedValidationError[];
  configuration: string;
}

interface BackendLinterOptions {
  api: ESPHomeAPI;
  /** Live accessor — the configuration may change over the editor's lifetime. */
  getConfiguration: () => string;
  /** Localizes the humanized YAML-error hints (indentation / tab messages). */
  localize: LocalizeFunc;
  /**
   * Called after every lint pass with the resulting error messages and the
   * configuration they were computed for, so the host can surface a
   * document-level "configuration invalid" indicator that names the actual
   * errors and ignore a late result from a since-switched device. The
   * mapped list carries the validation errors that resolved to a key path
   * in the open document, so the host can route them onto form fields.
   * Fires with empty lists for an empty/un-configured buffer or a failed
   * round-trip.
   */
  onResult?: (
    errors: BannerError[],
    mapped: MappedValidationError[],
    configuration: string
  ) => void;
  /**
   * Called when the user picks the auto-fix action on a diagnostic's hover
   * tooltip, with the same repair payload the banner button carries — the
   * host routes both through one validate-confirm-apply path.
   */
  onAutoFix?: (fix: YamlAutoFix) => void;
}

/**
 * Last successful linter result per configuration, keyed on exact
 * content. The save path consults this to skip its own `validateYaml`
 * WS round-trip when the linter just validated the same buffer.
 *
 * TTL mirrors the backend's `_VALIDATE_CACHE_TTL` (60s) so staleness
 * semantics for externally-mutated `!include` /
 * `external_components` files are symmetric on both paths.
 */
const _LAST_VALIDATED_TTL_MS = 60_000;
const _lastValidated = new Map<
  string,
  { content: string; result: EditorValidateResponse; at: number }
>();

/** Return the linter's last result if it matches the current buffer and is fresh. */
export function getLastValidatedResult(
  configuration: string,
  content: string
): EditorValidateResponse | null {
  const entry = _lastValidated.get(configuration);
  if (entry === undefined || entry.content !== content) return null;
  if (performance.now() - entry.at >= _LAST_VALIDATED_TTL_MS) return null;
  return entry.result;
}

/** Test-only seed; production populates the map only through the linter. */
export function __setLastValidatedForTesting(
  configuration: string,
  content: string,
  result: EditorValidateResponse
): void {
  _lastValidated.set(configuration, { content, result, at: performance.now() });
}

/** ESPHome's root block — where structural "whole config" errors land. */
const CORE_BLOCK_KEY = "esphome";

/** Lint-tooltip DOM for a message, autolinking bare URLs to new-tab anchors. */
export function renderMessageNode(message: string): HTMLSpanElement {
  const span = document.createElement("span");
  for (const seg of splitTextLinks(message)) {
    if (seg.href) {
      const link = document.createElement("a");
      link.href = seg.href;
      link.textContent = seg.text;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "cm-diagnostic-link";
      span.appendChild(link);
    } else {
      span.appendChild(document.createTextNode(seg.text));
    }
  }
  return span;
}

/** Match a `key:` declaration, capturing its indent and the key token. */
const KEY_LINE_RE = /^(\s*)([^\s:#][^:]*?)\s*:(?:\s|$)/;

/** The key declared on the line containing *offset*, or `null`. */
function keyAt(doc: Text, offset: number): string | null {
  const hit = doc.lineAt(offset).text.match(KEY_LINE_RE);
  return hit ? hit[2] : null;
}

/**
 * Trim a range that only spills onto blank lines (or the start of the
 * next line) back to its last content line. ESPHome's end marks often
 * land at column 0 past a blank separator, making single-line content
 * read as multi-line.
 */
export function trimRangeToContent(
  doc: Text,
  range: { from: number; to: number }
): { from: number; to: number } {
  const startLine = doc.lineAt(range.from);
  let toLine = doc.lineAt(range.to);
  while (
    toLine.number > startLine.number &&
    !doc.sliceString(toLine.from, Math.min(range.to, toLine.to)).trim()
  ) {
    toLine = doc.line(toLine.number - 1);
    range = { from: range.from, to: toLine.to };
  }
  return range;
}

/**
 * Move a block-level validation error onto the key of its enclosing block.
 *
 * ESPHome marks "Component not found" / "Platform missing" on the block's
 * value mapping, so a multi-line range spans the children. Walk it up to
 * the first less-indented `key:` line (clamp to the first line if none).
 * Expects a range already trimmed with trimRangeToContent, so single-line
 * content passes through untouched — it's already precise.
 */
export function retargetBlockDiagnostic(
  doc: Text,
  fallback: { from: number; to: number }
): { from: number; to: number } {
  const startLine = doc.lineAt(fallback.from);
  if (doc.lineAt(fallback.to).number === startLine.number) return fallback;

  const startIndent = indentOf(startLine.text);
  for (let n = startLine.number - 1; n >= 1; n--) {
    const line = doc.line(n);
    const text = line.text;
    if (!text.trim() || text.trimStart().startsWith("#")) continue; // skip blank/comment
    if (indentOf(text) >= startIndent) continue; // still inside the block
    const hit = text.match(KEY_LINE_RE); // first less-indented line = enclosing key
    if (hit) {
      const from = line.from + hit[1].length;
      return { from, to: from + hit[2].length };
    }
    break; // less-indented but not a key — fall through to the clamp
  }
  // No enclosing key — at least keep the underline on the first line.
  return { from: startLine.from + startIndent, to: startLine.to };
}

/**
 * Translate an upstream range (0-indexed start_line/start_col/end_line/end_col)
 * into editor character offsets, clamped to the document.
 */
function rangeToOffsets(
  view: EditorView,
  range: { start_line: number; start_col: number; end_line: number; end_col: number }
): { from: number; to: number } {
  const doc = view.state.doc;
  const totalLines = doc.lines;

  const startLine = Math.min(Math.max(range.start_line + 1, 1), totalLines);
  const endLine = Math.min(Math.max(range.end_line + 1, 1), totalLines);

  const startInfo = doc.line(startLine);
  const endInfo = doc.line(endLine);

  const from = Math.min(startInfo.from + Math.max(0, range.start_col), startInfo.to);
  let to = Math.min(endInfo.from + Math.max(0, range.end_col), endInfo.to);

  // Empty range — extend to cover at least a single character so the
  // wavy underline is visible. Prefer the trailing character if possible,
  // otherwise the start of the next line.
  if (to <= from) {
    if (from < startInfo.to) {
      to = from + 1;
    } else if (startLine < totalLines) {
      to = doc.line(startLine + 1).from;
    } else {
      to = startInfo.to;
    }
  }
  return { from, to };
}

/**
 * Underline a whole logical line. Used for YAML parse errors whose only
 * positional info is "line N, column M" extracted from the message.
 */
function lineToOffsets(
  view: EditorView,
  line1: number,
  col1: number | null
): { from: number; to: number } {
  const doc = view.state.doc;
  const lineNum = Math.min(Math.max(line1, 1), doc.lines);
  const info = doc.line(lineNum);
  if (col1 !== null) {
    const start = Math.min(info.from + Math.max(0, col1 - 1), info.to);
    const end = Math.min(start + 1, info.to);
    return { from: start, to: end > start ? end : info.to };
  }
  // No column → underline the whole line content, skipping the leading
  // space indent for a tighter visual. Spaces-only on purpose: a leading
  // tab is invalid YAML, and yamllint reports it with its own precise
  // column, so this fallback rarely sees one; when it does, the underline
  // simply starts at the offending tab instead of after it.
  const text = info.text;
  const from = info.from + indentOf(text);
  return { from, to: info.to };
}

/**
 * Build a `linter()` extension that calls `editor/validate_yaml` whenever the
 * editor is idle. Debounced via `linter`'s built-in `delay` (defaults to 750ms;
 * we drop it to 600ms — fast enough to feel live, slow enough to not flood
 * the subprocess).
 */
export function createBackendYamlLinter(opts: BackendLinterOptions): Extension {
  return linter(
    async (view) => {
      const configuration = opts.getConfiguration();
      if (!configuration) {
        opts.onResult?.([], [], configuration);
        return [];
      }
      const content = view.state.doc.toString();
      if (!content.trim()) {
        opts.onResult?.([], [], configuration);
        return [];
      }

      let res: EditorValidateResponse;
      try {
        res = await opts.api.validateYaml(configuration, content);
      } catch (err) {
        // Surface backend errors quietly in the console — we don't want a
        // network blip to flood the editor with spurious diagnostics.
        console.debug("[yaml-lint] validate_yaml failed:", err);
        opts.onResult?.([], [], configuration);
        return [];
      }
      _lastValidated.set(configuration, { content, result: res, at: performance.now() });

      const diagnostics: Diagnostic[] = [];
      // Banner material. A locatable YAML parse error goes to BOTH an inline
      // squiggle and the banner (with an optional auto-fix). A whole-config
      // error (pinned on the root esphome block, an included-file error, or an
      // unplaceable parse error) goes to the banner only; a localized
      // validation error keeps its squiggle and also resolves to a key path so
      // the host can pin it on the matching form field.
      const bannerErrors: BannerError[] = [];
      const mapped: MappedValidationError[] = [];

      // YAML parse errors — usually one, no range, message contains
      // "line N, column M".
      const doc = view.state.doc;
      const readLine: ReadLine = (n) =>
        n >= 1 && n <= doc.lines ? doc.line(n).text : undefined;
      const onAutoFix = opts.onAutoFix;
      // Offer the one-click repair on the squiggle's hover tooltip — while
      // the banner reveal is damped during typing, the tooltip is where the
      // fix is discoverable.
      const autoFixActions = (fix: YamlAutoFix | undefined) =>
        fix && onAutoFix
          ? [
              {
                name: opts.localize("yaml_editor.error_auto_fix"),
                apply: () => onAutoFix(fix),
              },
            ]
          : undefined;
      for (const err of res.yaml_errors ?? []) {
        const msg = err.message ?? "";
        const pos = parseYamlErrorPosition(msg);
        // Prefer a plain-language fix (the exact line + space delta when
        // the document lets us pinpoint it) over the raw scanner jargon.
        const {
          text: message,
          jumpLine,
          fix,
          squiggleLine,
        } = describeYamlError(msg, pos, opts.localize, readLine);
        if (pos === null) {
          bannerErrors.push({ message, kind: "parse" }); // no position to squiggle
          continue;
        }
        const { from, to } =
          squiggleLine !== undefined
            ? lineToOffsets(view, squiggleLine, null)
            : lineToOffsets(view, pos.line, pos.col);
        diagnostics.push({
          from,
          to,
          severity: "error",
          source: "yaml",
          message,
          renderMessage: () => renderMessageNode(message),
          actions: autoFixActions(fix),
        });
        // Also surface it in the persistent banner — a squiggle plus a
        // gutter dot is easy to miss — with the fix site to jump to and,
        // when we can pinpoint it, a one-click auto-fix.
        bannerErrors.push({ message, line: jumpLine ?? pos.line, fix, kind: "parse" });
      }

      // Schema/validation errors carry an explicit range.
      for (const err of res.validation_errors ?? []) {
        let message =
          sanitizeMessage((err.message ?? "").trim()) || "Invalid configuration";
        // The upstream validator emits a null range when it can't place the
        // error, and a foreign document when the error lives in an included
        // file — neither has a location in this buffer.
        if (!err.range || !isOpenConfigFile(err.range.document ?? "", configuration)) {
          bannerErrors.push({ message, kind: "validation" });
          continue;
        }
        const anchor = trimRangeToContent(doc, rangeToOffsets(view, err.range));
        const { from, to } = retargetBlockDiagnostic(doc, anchor);
        // Pinned on the `esphome:` core block → whole-config error → banner.
        if (keyAt(doc, from) === CORE_BLOCK_KEY) {
          bannerErrors.push({ message, kind: "validation" });
          continue;
        }
        // A bare "expected a dictionary." reads as nonsense — when the
        // anchored line shows why the value took the wrong type (nested
        // list items, a half-typed key with no ':', a dash stuck to its
        // key), name that cause, and carry its repair when it has one.
        const squiggleLineNum = doc.lineAt(from).number;
        const cause = describeValueTypeCause(readLine, squiggleLineNum, opts.localize);
        if (cause) message = `${message} ${cause.text}`;
        diagnostics.push({
          from,
          to,
          severity: "error",
          source: "esphome",
          message,
          renderMessage: () => renderMessageNode(message),
          actions: autoFixActions(cause?.fix),
        });
        // Map from the range's own start, not the retargeted squiggle: a
        // block error walked up to its enclosing key would attribute to
        // the wrong list instance (the range starts inside the broken
        // item; the enclosing key covers them all). Anchor inside the
        // first token — side -1 at the exact start would resolve to the
        // preceding node.
        let keyPath = getKeyPathWithListIndices(
          view.state,
          Math.min(anchor.from + 1, anchor.to)
        );
        // A multi-line range anchored on a key token is a container-level
        // error: esphome marked a whole mapping, whose range starts at its
        // first key. That key is incidental — attribute the error to the
        // container so it lands on the section, not on an unrelated field.
        const anchorLine = doc.lineAt(anchor.from);
        if (
          keyPath.length > 0 &&
          doc.lineAt(anchor.to).number !== anchorLine.number &&
          KEY_LINE_RE.test(anchorLine.text.slice(anchor.from - anchorLine.from))
        ) {
          keyPath = keyPath.slice(0, -1);
        }
        if (keyPath.length > 0) {
          mapped.push({ message, line: anchorLine.number, keyPath });
        }
        // No form field to carry the message (a bare section header, or the
        // AST couldn't place it) — keep it in the banner; a section-level
        // error still badges the navigator through the mapped entry. The
        // anchor line gives the banner its "Go to line" jump.
        if (formRelativePath(keyPath).length === 0) {
          bannerErrors.push({
            message,
            line: squiggleLineNum,
            fix: cause?.fix,
            kind: "validation",
          });
        }
      }

      opts.onResult?.(bannerErrors, mapped, configuration);
      return diagnostics;
    },
    {
      delay: 600,
      // Don't auto-open the panel — we only want the inline wavy underlines
      // and hover tooltip.
      autoPanel: false,
      // Re-run for unchanged content when a relintEffect is dispatched. A
      // secrets.yaml write doesn't touch the editor doc, so without this the
      // lint plugin has nothing scheduled and forceLinting() is a no-op.
      needsRefresh: (update) =>
        update.transactions.some((tr) => tr.effects.some((e) => e.is(relintEffect))),
    }
  );
}

// Dispatch on the editor view to make the backend linter re-validate the
// current (unchanged) content, e.g. after a secrets.yaml write the doc can't
// see. Pair with forceLinting(view) to run it immediately.
export const relintEffect = StateEffect.define<null>();

/** Tags a line so its line-number gutter cell renders the error icon. */
const errorLineMarker = new (class extends GutterMarker {
  elementClass = "cm-lint-error-line";
})();

/** One marker per line that carries a lint error, sorted by document offset. */
function errorLineGutterMarkers(state: EditorState): RangeSet<GutterMarker> {
  const lineStarts: number[] = [];
  const seen = new Set<number>();
  forEachDiagnostic(state, (diagnostic, from) => {
    if (diagnostic.severity !== "error") return;
    const start = state.doc.lineAt(from).from;
    if (!seen.has(start)) {
      seen.add(start);
      lineStarts.push(start);
    }
  });
  lineStarts.sort((a, b) => a - b);
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const start of lineStarts) builder.add(start, start, errorLineMarker);
  return builder.finish();
}

/**
 * Replace the line number with an error icon on lines carrying a lint
 * error, instead of reserving a separate lint-gutter column. The
 * line-number gutter keeps a fixed width, so an error never reflows the
 * editor and the icon stays aligned with the number column. Must be wired
 * after the linter so the diagnostics state it reads is populated.
 */
export const lintErrorLineGutter: Extension = StateField.define<RangeSet<GutterMarker>>({
  create: errorLineGutterMarkers,
  update: (_value, tr) => errorLineGutterMarkers(tr.state),
  provide: (field) => gutterLineClass.from(field),
});
