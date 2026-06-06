/**
 * Line-based parse / splice for the structured secrets editor. The YAML
 * text is the source of truth, so each mutation rewrites only its one
 * line and comments / tags / blanks round-trip untouched. Only simple
 * top-level ``name: value`` scalars are editable; tags, anchors, merge
 * keys, block / flow collections and nested mappings are read-only.
 */

import { escapeYamlDoubleQuoted } from "./yaml-escape.js";
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

/** A run of secrets sharing a ``<device>__`` prefix; ``device`` is null for the shared run. */
export interface SecretGroup {
  device: string | null;
  entries: SecretEntry[];
}

// Top-level ``key:`` or ``key: value`` line. The colon must be followed
// by end-of-line or whitespace (``key:value`` with no space is a plain
// scalar in YAML, not a mapping). No leading indent — nested children
// are indented and never match, so a parent with a block value is left
// to the advanced (read-only) path. ``<<`` matches so an HA-style merge
// key surfaces as an advanced row rather than vanishing.
const TOP_LEVEL_KEY = /^(<<|[A-Za-z_][A-Za-z0-9_.\-]*):(?:[ \t]+([^\n]*))?$/;

const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_.\-]*$/;

// A value the form must not edit inline: a tag (!secret / !include), an
// anchor (&a) / alias (*a), a block scalar (| or >), or a flow
// collection ([ ] / { }).
const ADVANCED_VALUE_START = /^[!&*|>[{]/;

// ``formatYamlScalar`` quotes most unsafe scalars (``:`` ``#`` leading
// ``-`` / space / quote, booleans, numbers …) but not a value that
// *starts* with a YAML indicator (``! & * | > [ ] { } @ \` %``). Written
// bare, such a value reparses as a tag / anchor / block marker and
// vanishes from the form, so force-quote it.
const LEADING_INDICATOR = /^[!&*|>[\]{}@`%]/;

export function isValidSecretKey(key: string): boolean {
  return VALID_KEY.test(key);
}

/** Group entries into shared-then-per-device runs by the ``<device>__`` key prefix. */
export function groupSecretsByDevice(entries: SecretEntry[]): SecretGroup[] {
  const order: (string | null)[] = [];
  const byDevice = new Map<string | null, SecretEntry[]>();
  for (const entry of entries) {
    const sep = entry.key.indexOf("__");
    const device = sep > 0 ? entry.key.slice(0, sep) : null;
    if (!byDevice.has(device)) {
      byDevice.set(device, []);
      order.push(device);
    }
    byDevice.get(device)!.push(entry);
  }
  // Shared (no prefix) first, then device runs in first-appearance order.
  // Built explicitly rather than via a partial-order sort comparator.
  const ordered = byDevice.has(null) ? [null, ...order.filter((d) => d !== null)] : order;
  return ordered.map((device) => ({ device, entries: byDevice.get(device)! }));
}

function formatSecretValue(value: string): string {
  if (value !== "" && LEADING_INDICATOR.test(value)) {
    return `"${escapeYamlDoubleQuoted(value)}"`;
  }
  return formatYamlScalar(value);
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

/** Replace the value of the entry at *line*, or null when it no longer matches. */
export function setSecretValue(yaml: string, line: number, value: string): string | null {
  return rewriteLine(yaml, line, (key, _value, comment) => {
    return `${key}: ${formatSecretValue(value)}${comment}`;
  });
}

/** Rename the key of the entry at *line*, or null when it no longer matches. */
export function renameSecretKey(
  yaml: string,
  line: number,
  newKey: string
): string | null {
  return rewriteLine(yaml, line, (_key, value, comment) => {
    // A bare ``key:`` has no value or comment; keep it bare so the rename
    // doesn't leave a trailing space.
    return value === "" && comment === ""
      ? `${newKey}:`
      : `${newKey}: ${value}${comment}`;
  });
}

/** Append a new ``key: value`` line to *yaml*. */
export function addSecret(yaml: string, key: string, value: string): string {
  const entry = `${key}: ${formatSecretValue(value)}`;
  if (yaml === "") return `${entry}\n`;
  const sep = yaml.endsWith("\n") ? "" : "\n";
  return `${yaml}${sep}${entry}\n`;
}

/** Drop the entry's line from *yaml*, or null when it no longer holds a key. */
export function removeSecret(yaml: string, line: number): string | null {
  const lines = yaml.split("\n");
  // Validate the target still holds a key so a stale index can't delete an
  // unrelated comment / blank / other line.
  if (line < 0 || line >= lines.length || !TOP_LEVEL_KEY.test(lines[line])) return null;
  lines.splice(line, 1);
  return lines.join("\n");
}

function readValue(
  rest: string | undefined,
  lines: string[],
  index: number
): { value: string; editable: boolean } {
  const { value } = splitInlineComment(rest ?? "");
  const trimmed = value.trim();
  // A bare ``key:`` or a comment-only value (``key: # note``) is an editable
  // empty scalar unless an indented block sits below it, which makes it
  // advanced — editing it inline would orphan the nested children.
  if (trimmed === "" || trimmed.startsWith("#")) {
    return { value: "", editable: !hasIndentedChild(lines, index) };
  }
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
): string | null {
  const lines = yaml.split("\n");
  const match = lines[line]?.match(TOP_LEVEL_KEY);
  if (!match) return null;
  const [, key, rest] = match;
  const { value, comment } = splitInlineComment(rest ?? "");
  lines[line] = build(key, value, comment);
  return lines.join("\n");
}
