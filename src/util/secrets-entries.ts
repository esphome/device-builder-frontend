/**
 * Line-based parse / splice for the structured secrets editor.
 *
 * The YAML text is the source of truth: every mutation rewrites only the
 * one affected line so comments, blank lines, and tagged / block values
 * round-trip byte-stable. Only simple top-level ``name: value`` scalars
 * are marked editable; anything else (a ``!secret`` / ``!include`` tag,
 * an anchor / alias / merge key, a block or flow collection, a nested
 * mapping) is surfaced read-only so the form can never clobber it.
 */

import { splitInlineComment, stripQuotes } from "./yaml-scalar.js";
import { formatYamlScalar } from "./yaml-serialize.js";

export interface SecretEntry {
  /** Top-level key name. */
  key: string;
  /** Display value for an editable scalar (quotes stripped, comment dropped); "" otherwise. */
  value: string;
  /** 0-based index of the key's line in the source text. */
  line: number;
  /** True when the value is a single-line inline scalar safe to edit in the form. */
  editable: boolean;
}

// Top-level ``key:`` or ``key: value`` line. The colon must be followed
// by end-of-line or whitespace (``key:value`` with no space is a plain
// scalar in YAML, not a mapping). No leading indent — nested children
// are indented and never match, so a parent with a block value is left
// to the advanced (read-only) path.
const TOP_LEVEL_KEY = /^([A-Za-z_][A-Za-z0-9_.\-]*):(?:[ \t]+([^\n]*))?$/;

const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_.\-]*$/;

// A value the form must not edit inline: a tag (!secret / !include), an
// anchor (&a) / alias (*a), a block scalar (| or >), or a flow
// collection ([ ] / { }).
const ADVANCED_VALUE_START = /^[!&*|>[{]/;

export function isValidSecretKey(key: string): boolean {
  return VALID_KEY.test(key);
}

/** Parse *yaml* into one entry per top-level key line. */
export function parseSecretsEntries(yaml: string): SecretEntry[] {
  const lines = yaml.split("\n");
  const entries: SecretEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(TOP_LEVEL_KEY);
    if (!match) continue;
    const [, key, rest] = match;
    entries.push({ key, line: i, ...readValue(rest, lines, i) });
  }
  return entries;
}

/** Replace the value of the entry at *line*, preserving key and comment. */
export function setSecretValue(yaml: string, line: number, value: string): string {
  return rewriteLine(yaml, line, (key, _value, comment) => {
    return `${key}: ${formatYamlScalar(value)}${comment}`;
  });
}

/** Rename the key of the entry at *line*, preserving value and comment. */
export function renameSecretKey(yaml: string, line: number, newKey: string): string {
  return rewriteLine(yaml, line, (_key, value, comment) => {
    return `${newKey}: ${value}${comment}`;
  });
}

/** Append a new ``key: value`` line to *yaml*. */
export function addSecret(yaml: string, key: string, value: string): string {
  const entry = `${key}: ${formatYamlScalar(value)}`;
  if (yaml === "") return `${entry}\n`;
  const sep = yaml.endsWith("\n") ? "" : "\n";
  return `${yaml}${sep}${entry}\n`;
}

/** Drop the entry's line from *yaml*. */
export function removeSecret(yaml: string, line: number): string {
  const lines = yaml.split("\n");
  if (line < 0 || line >= lines.length) return yaml;
  lines.splice(line, 1);
  return lines.join("\n");
}

function readValue(
  rest: string | undefined,
  lines: string[],
  index: number
): { value: string; editable: boolean } {
  if (rest === undefined || rest.trim() === "") {
    // Bare ``key:`` — a nested block below makes it advanced, otherwise
    // it's an editable empty value.
    return { value: "", editable: !hasIndentedChild(lines, index) };
  }
  const { value } = splitInlineComment(rest);
  const trimmed = value.trim();
  if (ADVANCED_VALUE_START.test(trimmed)) return { value: "", editable: false };
  return { value: stripQuotes(trimmed), editable: true };
}

function hasIndentedChild(lines: string[], index: number): boolean {
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    return /^[ \t]/.test(line);
  }
  return false;
}

function rewriteLine(
  yaml: string,
  line: number,
  build: (key: string, value: string, comment: string) => string
): string {
  const lines = yaml.split("\n");
  const match = lines[line]?.match(TOP_LEVEL_KEY);
  if (!match) return yaml;
  const [, key, rest] = match;
  const { value, comment } = splitInlineComment(rest ?? "");
  lines[line] = build(key, value, comment);
  return lines.join("\n");
}
