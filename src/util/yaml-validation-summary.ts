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
 * Position extraction, path sanitizing, and the plain-language
 * rewrite come from ``yaml-error-analysis.ts`` — the same functions
 * the inline linter uses — so the dialog names the same line and
 * shows the same wording as the banner and squiggles.
 */

import type { EditorValidateResponse } from "../api/types/editor.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  describeValueTypeCause,
  describeYamlError,
  lineAccessorFor,
  parseYamlErrorPosition,
  sanitizeMessage,
} from "./yaml-error-analysis.js";

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
export function summarizeValidation(
  res: EditorValidateResponse,
  content: string,
  localize: LocalizeFunc
): ValidationSummary {
  const yamlErrors = res.yaml_errors ?? [];
  const validationErrors = res.validation_errors ?? [];
  const count = yamlErrors.length + validationErrors.length;
  if (count === 0) return { count: 0, first: null };

  const readLine = lineAccessorFor(content);
  if (yamlErrors.length > 0) {
    const msg = (yamlErrors[0].message ?? "").trim();
    const pos = parseYamlErrorPosition(msg);
    const { text, jumpLine } = describeYamlError(msg, pos, localize, readLine);
    const line = jumpLine ?? 0;
    // A jump retargeted off the problem mark (onto the fix site or the
    // context line) has no meaningful column in the original message.
    const col = pos !== null && pos.line === line && pos.col !== null ? pos.col : 0;
    return {
      count,
      first: {
        line,
        col: col >= 1 ? col : 0,
        message: text || "Invalid YAML",
        file: null,
      },
    };
  }

  const err = validationErrors[0];
  // ``range.start_line`` / ``start_col`` are 0-indexed upstream; convert to
  // the 1-indexed shape the editor + URL helpers use. A missing range means
  // the validator couldn't place the error — line 0 disables "Go to error"
  // rather than jumping to the top of the file.
  const hasRange = err.range != null;
  const line = hasRange ? Math.max(1, (err.range?.start_line ?? 0) + 1) : 0;
  const col = hasRange ? Math.max(1, (err.range?.start_col ?? 0) + 1) : 0;
  const file = err.range?.document ?? null;
  let message = sanitizeMessage((err.message ?? "Invalid configuration").trim());
  // The cause hint reads the open buffer, so only add it when the error's
  // line refers to that buffer (the ``"<file>"`` sentinel / missing document
  // means the open config — see ``isOpenConfigFile``). Deliberate trade-off:
  // this anchors on the raw range line, while the banner anchors on its
  // CodeMirror-retargeted range (which can't live in this pure module) —
  // when the two diverge the shape check fails and the hint is simply
  // omitted, never wrong.
  if (hasRange && (!file || file === "<file>")) {
    const cause = describeValueTypeCause(readLine, line, localize);
    if (cause) message = `${message} ${cause.text}`;
  }
  return { count, first: { line, col, message, file } };
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
