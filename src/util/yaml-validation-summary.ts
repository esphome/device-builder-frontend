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

import type { EditorValidateResponse } from "../api/types.js";

const YAML_LINE_COL_RE = /line\s+(\d+)\s*,\s*column\s+(\d+)/i;
const YAML_LINE_RE = /line\s+(\d+)/i;

export interface ValidationFirstError {
  /** 1-indexed line, or 0 if the error has no resolvable line. */
  line: number;
  /** 1-indexed column, or 0 if absent / unresolvable. */
  col: number;
  /** Trimmed message — feeds the dialog's "first error" hint. */
  message: string;
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
    return { count, first: { line, col, message: message || "Invalid YAML" } };
  }

  const err = validationErrors[0];
  // ``range.start_line`` / ``start_col`` are 0-indexed upstream;
  // convert to the 1-indexed shape the editor + URL helpers use.
  const line = Math.max(1, (err.range?.start_line ?? 0) + 1);
  const col = Math.max(1, (err.range?.start_col ?? 0) + 1);
  const message = (err.message ?? "Invalid configuration").trim();
  return { count, first: { line, col, message } };
}
