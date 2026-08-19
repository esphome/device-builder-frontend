/**
 * Live YAML validation editor types.
 *
 * Part of the src/api/types.ts barrel split.
 */

import type { YamlDiff } from "./automations.js";

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

// ─── Editor (config migration) ──────────────────────────────

/** How a migration rule edits the config; drives the nudge's phrasing. */
export type MigrationChangeKind = "key" | "field" | "fold" | "convert" | "action";

/** One rule ``editor/migrate_config`` applied to the draft. */
export interface MigrationChange {
  kind: MigrationChangeKind;
  /** Block (``api``) or ``domain.platform`` the edit lives in; empty for ``key`` / ``action``. */
  scope: string;
  old: string;
  new: string;
  /** ESPHome version that introduced the rename, when known. */
  since: string | null;
  /** ESPHome version that drops the old spelling, when known. */
  removed_in: string | null;
  /** The installed ESPHome already rejects the old spelling. */
  required: boolean;
}

export interface MigrateConfigResponse {
  /** ``null`` when nothing needed migrating. */
  yaml_diff: YamlDiff | null;
  changes: MigrationChange[];
}
