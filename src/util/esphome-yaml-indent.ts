/**
 * Single source of truth for ESPHome YAML's indent width. Two
 * spaces matches the legacy dashboard and the upstream ESPHome
 * code style. Exported so consumers (the editor, tests) share
 * the same unit and the indent service derives ``step`` from it.
 *
 * A leaf module (no imports) so the lexer and line walkers can
 * depend on it without pulling in the CodeMirror language stack
 * or closing an import cycle.
 */
export const ESPHOME_YAML_INDENT = "  ";
