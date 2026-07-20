/**
 * Shared input contract for the async, catalog-gated fix analyzers the
 * backend linter chains (`yaml-invalid-option-fix`,
 * `yaml-component-not-found-fix`).
 */
import type { EditorState } from "@codemirror/state";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { LocalizeFunc } from "../common/localize.js";

export interface YamlFixContext {
  api: ESPHomeAPI;
  state: EditorState;
  /** The sanitized validation-error message. */
  message: string;
  /** 1-indexed line the squiggle anchors on. */
  blamedLine: number;
  localize: LocalizeFunc;
}
