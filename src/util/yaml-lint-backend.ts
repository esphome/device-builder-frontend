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
import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { EditorValidateResponse } from "../api/types.js";

interface BackendLinterOptions {
  api: ESPHomeAPI;
  /** Live accessor — the configuration may change over the editor's lifetime. */
  getConfiguration: () => string;
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

/** Match `line N, column M` (1-indexed) anywhere in a YAML parse error message. */
const YAML_LINE_COL_RE = /line\s+(\d+)\s*,\s*column\s+(\d+)/i;
/** Fallback: bare `line N` if the column is missing from the message. */
const YAML_LINE_RE = /line\s+(\d+)/i;

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
      if (!configuration) return [];
      const content = view.state.doc.toString();
      if (!content.trim()) return [];

      let res: EditorValidateResponse;
      try {
        res = await opts.api.validateYaml(configuration, content);
      } catch (err) {
        // Surface backend errors quietly in the console — we don't want a
        // network blip to flood the editor with spurious diagnostics.
        console.debug("[yaml-lint] validate_yaml failed:", err);
        return [];
      }
      _lastValidated.set(configuration, { content, result: res, at: performance.now() });

      const diagnostics: Diagnostic[] = [];

      // YAML parse errors — usually one, no range, message contains
      // "line N, column M".
      for (const err of res.yaml_errors ?? []) {
        const msg = err.message ?? "";
        let line: number | null = null;
        let col: number | null = null;
        const both = msg.match(YAML_LINE_COL_RE);
        if (both) {
          line = Number.parseInt(both[1], 10);
          col = Number.parseInt(both[2], 10);
        } else {
          const lineOnly = msg.match(YAML_LINE_RE);
          if (lineOnly) line = Number.parseInt(lineOnly[1], 10);
        }
        if (line === null || Number.isNaN(line)) continue;
        const { from, to } = lineToOffsets(view, line, col);
        diagnostics.push({
          from,
          to,
          severity: "error",
          source: "yaml",
          message: msg.trim() || "Invalid YAML",
        });
      }

      // Schema/validation errors carry an explicit range.
      for (const err of res.validation_errors ?? []) {
        const { from, to } = rangeToOffsets(view, err.range);
        diagnostics.push({
          from,
          to,
          severity: "error",
          source: "esphome",
          message: (err.message ?? "Invalid configuration").trim(),
        });
      }

      return diagnostics;
    },
    {
      delay: 600,
      // Don't auto-open the panel — we only want the inline wavy underlines
      // and hover tooltip.
      autoPanel: false,
    }
  );
}
