/**
 * Live YAML validation editor types.
 *
 * Part of the src/api/types.ts barrel split.
 */

// ─── Editor (live YAML validation) ──────────────────────────

/** Range emitted by the upstream `esphome vscode --ace` validator. 0-indexed. */
export interface EditorRange {
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
  range: EditorRange;
}

export interface EditorValidateResponse {
  yaml_errors: EditorYamlError[];
  validation_errors: EditorValidationError[];
}
