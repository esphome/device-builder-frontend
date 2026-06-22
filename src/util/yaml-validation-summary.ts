/**
 * Reduce an ``EditorValidateResponse`` to a "first error" summary
 * the save-time validation prompt can show.
 *
 * The save flow re-validates with ``api.validateYaml`` and, when
 * errors come back, asks the user whether to save anyway or jump
 * to the first failing line. The dialog only needs:
 *
 *  - the total error count (badge / message wording);
 *  - one representative line/column to deep-link the editor at;
 *  - the message of that representative error.
 *
 * Mirrors ``yaml-lint-backend.ts``'s line/column extraction so the
 * dialog points at the same diagnostic the inline wavy underlines
 * would point at — yaml parse errors come from a regex against
 * the message string, validation errors carry an explicit
 * ``range``.
 */

import type { EditorValidateResponse } from "../api/types/editor.js";

const YAML_LINE_COL_RE = /line\s+(\d+)\s*,\s*column\s+(\d+)/i;
const YAML_LINE_RE = /line\s+(\d+)/i;
/** Windows path separators, normalized to ``/`` before comparison. */
const BACKSLASH_RE = /\\/g;

export interface ValidationFirstError {
  /** 1-indexed line, or 0 if the error has no resolvable line. */
  line: number;
  /** 1-indexed column, or 0 if absent / unresolvable. */
  col: number;
  /** Trimmed message — feeds the dialog's "first error" hint. */
  message: string;
  /** Source file the error came from, or null when the validator didn't report one. */
  file: string | null;
}

export interface ValidationSummary {
  /** Total errors across both buckets. */
  count: number;
  /** First error's coordinates + message, or null when ``count === 0``. */
  first: ValidationFirstError | null;
}

/**
 * YAML parse errors win precedence over validation errors — the
 * upstream pipeline rejects parse-broken YAML before the schema
 * validator runs, so a parse error is the only error in that
 * case anyway. When parse errors are absent, take the first
 * validation error's range.
 */
export function summarizeValidation(res: EditorValidateResponse): ValidationSummary {
  const yamlErrors = res.yaml_errors ?? [];
  const validationErrors = res.validation_errors ?? [];
  const count = yamlErrors.length + validationErrors.length;
  if (count === 0) return { count: 0, first: null };

  if (yamlErrors.length > 0) {
    const err = yamlErrors[0];
    const message = (err.message ?? "").trim();
    let line = 0;
    let col = 0;
    const both = message.match(YAML_LINE_COL_RE);
    if (both) {
      line = Number.parseInt(both[1], 10);
      col = Number.parseInt(both[2], 10);
    } else {
      const lineOnly = message.match(YAML_LINE_RE);
      if (lineOnly) line = Number.parseInt(lineOnly[1], 10);
    }
    if (!Number.isFinite(line) || line < 1) line = 0;
    if (!Number.isFinite(col) || col < 1) col = 0;
    return {
      count,
      first: { line, col, message: message || "Invalid YAML", file: null },
    };
  }

  const err = validationErrors[0];
  // ``range.start_line`` / ``start_col`` are 0-indexed upstream;
  // convert to the 1-indexed shape the editor + URL helpers use.
  const line = Math.max(1, (err.range?.start_line ?? 0) + 1);
  const col = Math.max(1, (err.range?.start_col ?? 0) + 1);
  const message = (err.message ?? "Invalid configuration").trim();
  return { count, first: { line, col, message, file: err.range?.document ?? null } };
}

/** Last path segment of a ``/``- or ``\``-separated path. */
export function basename(path: string): string {
  const normalized = path.replace(BACKSLASH_RE, "/");
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/**
 * Whether a validator ``document`` refers to the currently open
 * configuration rather than an ``!include``d file.

 * The ``esphome vscode --ace`` loader leaves the main file's stream
 * unnamed, so its nodes report the ``"<file>"`` sentinel (a missing
 * document means the same thing) while every ``!include``d file carries a
 * real resolved path — so the sentinel is the open file. A suffix match
 * on ``configuration`` is deliberately NOT used: it is usually a bare
 * filename, and an included ``packages/light.yaml`` would masquerade as
 * an open ``light.yaml`` and re-enable navigation into the wrong file.
 */
export function isOpenConfigFile(document: string, configuration: string): boolean {
  if (!document || document === "<file>") return true;
  return document.replace(BACKSLASH_RE, "/") === configuration.replace(BACKSLASH_RE, "/");
}
