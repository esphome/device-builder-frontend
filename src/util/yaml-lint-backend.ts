/**
 * CodeMirror linter backed by the dashboard's `editor/validate_yaml` API.
 *
 * Pipes the editor's current YAML through the upstream `esphome vscode --ace`
 * subprocess and converts the resulting `{yaml_errors, validation_errors}`
 * payload into CodeMirror `Diagnostic[]`. Validation errors carry a 0-indexed
 * `range` we can map directly; YAML parse errors only carry a message — we
 * extract the line/column with a regex and underline the affected line.
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
import { indentOf, parseListItemMarker } from "./yaml-line-walker.js";
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

/** Match `line N, column M` (1-indexed) globally in a YAML parse error message. */
const YAML_LINE_COL_RE = /line\s+(\d+)\s*,\s*column\s+(\d+)/gi;
/** Fallback: bare `line N` if the column is missing from the message. */
const YAML_LINE_RE = /line\s+(\d+)/gi;

/** A quoted path (POSIX `/` or Windows `\`) — keep the basename, drop the dir. */
const QUOTED_PATH_RE = /"([^"]*[/\\])([^"/\\]+)"/g;

/** ESPHome's root block — where structural "whole config" errors land. */
const CORE_BLOCK_KEY = "esphome";

/**
 * Strip absolute directory paths out of a backend error message.
 *
 * ESPHome / PyYAML errors embed the config's absolute path
 * (`"/Users/me/esphome/foo.yaml"` or `"C:\\Users\\me\\foo.yaml"`),
 * leaking the host filesystem layout and username into the UI. Collapse
 * any quoted path to its basename.
 */
export function sanitizeMessage(message: string): string {
  return message.replace(QUOTED_PATH_RE, '"$2"');
}

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

/**
 * Pull the real error location out of a PyYAML parse message.
 *
 * PyYAML reports the context mark (where the enclosing block started,
 * often line 1) first and the problem mark (where the bad token was
 * found) last, so the LAST `line N, column M` is the actual location.
 * Falls back to a bare `line N`; `null` when the message carries no
 * position at all.
 */
export function parseYamlErrorPosition(
  message: string
): { line: number; col: number | null } | null {
  const colMatches = [...message.matchAll(YAML_LINE_COL_RE)];
  if (colMatches.length) {
    const last = colMatches[colMatches.length - 1];
    return { line: Number.parseInt(last[1], 10), col: Number.parseInt(last[2], 10) };
  }
  const lineMatches = [...message.matchAll(YAML_LINE_RE)];
  if (lineMatches.length) {
    return {
      line: Number.parseInt(lineMatches[lineMatches.length - 1][1], 10),
      col: null,
    };
  }
  return null;
}

/** A line accessor over the current document; `undefined` past the ends. */
export type ReadLine = (line1: number) => string | undefined;

/**
 * Pinpoint the exact indentation fix behind a `mapping values ...` error.
 *
 * The classic cause is a list item whose properties are indented deeper
 * than the item's own key: `- platform: dht` then `    model:` makes the
 * `dht` scalar swallow `model`, and the scanner blames the property
 * line. Walk up from that line to the owning `- ` marker; when the
 * properties sit deeper than the marker's content column, the fix is to
 * indent the marker so the two line up. Returns the marker's line, key,
 * and the space delta, or `null` when the shape isn't this mismatch.
 */
export function analyzeIndentMismatch(
  readLine: ReadLine,
  errorLine: number
): { markerLine: number; markerKey: string; delta: number } | null {
  const errText = readLine(errorLine);
  if (errText === undefined || !errText.trim()) return null;
  const propIndent = indentOf(errText);
  // Bound the walk so a huge doc can't turn one lint pass into a scan.
  for (let n = errorLine - 1; n >= 1 && n >= errorLine - 50; n--) {
    const text = readLine(n);
    if (text === undefined || !text.trim()) continue;
    const marker = parseListItemMarker(text);
    if (!marker) {
      // Left the item's block once a line is shallower than the property.
      if (indentOf(text) < propIndent) return null;
      continue;
    }
    if (propIndent <= marker.contentCol) return null;
    return {
      markerLine: n,
      markerKey: marker.key,
      delta: propIndent - marker.contentCol,
    };
  }
  return null;
}

/** A one-click indentation repair: add `indent` spaces at the start of `line`. */
export interface YamlAutoFix {
  line: number;
  indent: number;
  /** The list item's own key, so the apply site can confirm the line still
   *  targets the same item after edits shift line numbers. */
  key: string;
}

/** A humanized YAML error: display text, best line to jump to, optional auto-fix. */
export interface YamlErrorDescription {
  text: string;
  jumpLine: number | null;
  fix?: YamlAutoFix;
}

/**
 * Rewrite a cryptic PyYAML scanner message into a plain-language fix.
 *
 * The scanner blames where parsing broke, not where the human erred, so
 * name the real cause and, for the over-indented list-item case, the
 * exact line + space delta to fix (with an auto-fix). Covers the common
 * scanner errors — indentation, tabs, unterminated strings, duplicate
 * keys, stray symbols — falling back to the sanitized original for the
 * rest. `jumpLine` is the best line to scroll to (the fix site when known).
 */
export function describeYamlError(
  message: string,
  pos: { line: number; col: number | null } | null,
  localize: LocalizeFunc,
  readLine?: ReadLine
): YamlErrorDescription {
  const fallback = sanitizeMessage(message.trim()) || "Invalid YAML";
  const line = pos?.line ?? null;
  if (line === null) return { text: fallback, jumpLine: null };
  const hint = (key: string): YamlErrorDescription => ({
    text: localize(key, { line }),
    jumpLine: line,
  });
  const lower = message.toLowerCase();

  // A stray tab or reserved symbol where a token was expected. ESPHome falls
  // back to pyyaml's pure-Python loader for readable errors, which names the
  // char via ``%r`` — a tab shows as the literal ``'\t'`` repr.
  if (lower.includes("cannot start any token")) {
    return message.includes("'\\t'")
      ? hint("yaml_editor.error_tab_hint")
      : hint("yaml_editor.error_char_hint");
  }
  // Unterminated quoted scalar — a `"` or `'` opened but never closed.
  if (
    lower.includes("unexpected end of stream") ||
    lower.includes("while scanning a quoted scalar")
  ) {
    return hint("yaml_editor.error_unterminated_string_hint");
  }
  // Same option set twice in a block.
  if (lower.includes("duplicate key")) {
    return hint("yaml_editor.error_duplicate_key_hint");
  }
  // Unclosed flow collection — a `[ ... ]` list or `{ ... }` mapping (both
  // loaders word it "while parsing a flow sequence/mapping").
  if (lower.includes("while parsing a flow")) {
    return hint("yaml_editor.error_flow_hint");
  }
  // Indentation family: the over-indented list-item swallow and its structural
  // cousins. Try to pinpoint the exact fix from the document.
  if (
    lower.includes("mapping values are not allowed") ||
    lower.includes("could not find expected ':'") ||
    lower.includes("expected <block end>")
  ) {
    const fix = readLine ? analyzeIndentMismatch(readLine, line) : null;
    if (fix) {
      return {
        text: localize("yaml_editor.error_indent_fix", {
          line: fix.markerLine,
          key: fix.markerKey,
          spaces: fix.delta,
        }),
        jumpLine: fix.markerLine,
        fix: { line: fix.markerLine, indent: fix.delta, key: fix.markerKey },
      };
    }
    return hint("yaml_editor.error_indent_hint");
  }
  return { text: fallback, jumpLine: line };
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
      for (const err of res.yaml_errors ?? []) {
        const msg = err.message ?? "";
        const pos = parseYamlErrorPosition(msg);
        // Prefer a plain-language fix (the exact line + space delta when
        // the document lets us pinpoint it) over the raw scanner jargon.
        const {
          text: message,
          jumpLine,
          fix,
        } = describeYamlError(msg, pos, opts.localize, readLine);
        if (pos === null) {
          bannerErrors.push({ message }); // no position to squiggle
          continue;
        }
        const { from, to } = lineToOffsets(view, pos.line, pos.col);
        diagnostics.push({
          from,
          to,
          severity: "error",
          source: "yaml",
          message,
          renderMessage: () => renderMessageNode(message),
        });
        // Also surface it in the persistent banner — a squiggle plus a
        // gutter dot is easy to miss — with the fix site to jump to and,
        // when we can pinpoint it, a one-click auto-fix.
        bannerErrors.push({ message, line: jumpLine ?? pos.line, fix });
      }

      // Schema/validation errors carry an explicit range.
      for (const err of res.validation_errors ?? []) {
        const message =
          sanitizeMessage((err.message ?? "").trim()) || "Invalid configuration";
        // The upstream validator emits a null range when it can't place the
        // error, and a foreign document when the error lives in an included
        // file — neither has a location in this buffer.
        if (!err.range || !isOpenConfigFile(err.range.document ?? "", configuration)) {
          bannerErrors.push({ message });
          continue;
        }
        const anchor = trimRangeToContent(doc, rangeToOffsets(view, err.range));
        const { from, to } = retargetBlockDiagnostic(doc, anchor);
        // Pinned on the `esphome:` core block → whole-config error → banner.
        if (keyAt(doc, from) === CORE_BLOCK_KEY) {
          bannerErrors.push({ message });
          continue;
        }
        diagnostics.push({
          from,
          to,
          severity: "error",
          source: "esphome",
          message,
          renderMessage: () => renderMessageNode(message),
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
        // error still badges the navigator through the mapped entry.
        if (formRelativePath(keyPath).length === 0) {
          bannerErrors.push({ message });
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
