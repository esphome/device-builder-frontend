/**
 * Live YAML validation editor types.
 *
 * Part of the src/api/types.ts barrel split.
 */

// ─── Editor (live YAML validation) ──────────────────────────

/** Range emitted by the upstream `esphome vscode --ace` validator. 0-indexed. */
export interface EditorRange {
  /** Source file the range came from; differs from the open config when the error is in an `!include`d file. */
  document?: string;
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
}

export interface EditorYamlError {
  message: string;
}

export interface EditorValidationError {
  message: string;
  /** Null when the upstream validator can't place the error in any file. */
  range: EditorRange | null;
}

export interface EditorValidateResponse {
  yaml_errors: EditorYamlError[];
  validation_errors: EditorValidationError[];
}
