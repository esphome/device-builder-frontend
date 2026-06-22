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
import { splitTextLinks } from "./markdown.js";

interface BackendLinterOptions {
  api: ESPHomeAPI;
  /** Live accessor — the configuration may change over the editor's lifetime. */
  getConfiguration: () => string;
  /**
   * Called after every lint pass with the resulting error messages and the
   * configuration they were computed for, so the host can surface a
   * document-level "configuration invalid" indicator that names the actual
   * errors and ignore a late result from a since-switched device. Fires with
   * `[]` for an empty/un-configured buffer or a failed round-trip.
   */
  onResult?: (errors: string[], configuration: string) => void;
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

/** Leading-whitespace width of a line. */
function indentOf(text: string): number {
  return text.length - text.trimStart().length;
}

/** Match a `key:` declaration, capturing its indent and the key token. */
const KEY_LINE_RE = /^(\s*)([^\s:#][^:]*?)\s*:(?:\s|$)/;

/** The key declared on the line containing *offset*, or `null`. */
function keyAt(doc: Text, offset: number): string | null {
  const hit = doc.lineAt(offset).text.match(KEY_LINE_RE);
  return hit ? hit[2] : null;
}

/**
 * Move a block-level validation error onto the key of its enclosing block.
 *
 * ESPHome marks "Component not found" / "Platform missing" on the block's
 * value mapping, so a multi-line range spans the children. Walk it up to
 * the first less-indented `key:` line (clamp to the first line if none).
 * Single-line ranges are already precise and pass through untouched.
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
  // No column → underline the whole line content (skip leading whitespace
  // for a tighter visual).
  const text = info.text;
  const leading = text.length - text.trimStart().length;
  const from = info.from + leading;
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
        opts.onResult?.([], configuration);
        return [];
      }
      const content = view.state.doc.toString();
      if (!content.trim()) {
        opts.onResult?.([], configuration);
        return [];
      }

      let res: EditorValidateResponse;
      try {
        res = await opts.api.validateYaml(configuration, content);
      } catch (err) {
        // Surface backend errors quietly in the console — we don't want a
        // network blip to flood the editor with spurious diagnostics.
        console.debug("[yaml-lint] validate_yaml failed:", err);
        opts.onResult?.([], configuration);
        return [];
      }
      _lastValidated.set(configuration, { content, result: res, at: performance.now() });

      const diagnostics: Diagnostic[] = [];
      // Whole-config errors (a structural error esphome pins on the root
      // `esphome:` block, or an unplaceable parse error) go in the banner
      // instead of a squiggle; localized errors keep their squiggle.
      const bannerErrors: string[] = [];

      // YAML parse errors — usually one, no range, message contains
      // "line N, column M".
      for (const err of res.yaml_errors ?? []) {
        const msg = err.message ?? "";
        const message = sanitizeMessage(msg.trim()) || "Invalid YAML";
        const pos = parseYamlErrorPosition(msg);
        if (pos === null) {
          bannerErrors.push(message); // no position to squiggle
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
      }

      // Schema/validation errors carry an explicit range.
      for (const err of res.validation_errors ?? []) {
        const message =
          sanitizeMessage((err.message ?? "").trim()) || "Invalid configuration";
        const { from, to } = retargetBlockDiagnostic(
          view.state.doc,
          rangeToOffsets(view, err.range)
        );
        // Pinned on the `esphome:` core block → whole-config error → banner.
        if (keyAt(view.state.doc, from) === CORE_BLOCK_KEY) {
          bannerErrors.push(message);
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
      }

      opts.onResult?.(bannerErrors, configuration);
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
