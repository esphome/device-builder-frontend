/**
 * Draft-buffer detection and rewrite of `esphome: name_add_mac_suffix`.
 * Line-level (not the section parser) so the one-token flip preserves
 * comments and formatting, and detection works on mid-edit drafts.
 */
import { stripQuotes } from "./yaml-scalar.js";
import { findDirectChildLine } from "./yaml-section-reader.js";
import { parseYamlBoolean } from "./yaml-serialize.js";

const KEY_VALUE_RE = /^(\s*name_add_mac_suffix\s*:\s*)([^#\s]+)/;

/** Zero-based line index of a truthy direct-child `name_add_mac_suffix:`
 *  under `esphome:`, or -1. */
export function findTruthyMacSuffixLine(yaml: string): number {
  return truthyLineIn(yaml.split("\n"));
}

/** Rewrite the truthy flag to `false`, preserving the rest of the line;
 *  `null` when the flag isn't set. */
export function disableMacSuffixInYaml(yaml: string): string | null {
  const lines = yaml.split("\n");
  const line = truthyLineIn(lines);
  if (line < 0) return null;
  lines[line] = lines[line].replace(KEY_VALUE_RE, "$1false");
  return lines.join("\n");
}

function truthyLineIn(lines: string[]): number {
  const line = findDirectChildLine(lines, "esphome", KEY_VALUE_RE);
  if (line < 0) return -1;
  const match = KEY_VALUE_RE.exec(lines[line]);
  return match !== null && parseYamlBoolean(stripQuotes(match[2])) === true ? line : -1;
}
