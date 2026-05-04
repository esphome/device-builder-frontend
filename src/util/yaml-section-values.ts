/**
 * Parse and rewrite key: value pairs in a section of a YAML document.
 *
 * Supports scalars (quoted/unquoted, booleans), block lists of scalars,
 * flow lists (`[a, b, c]`), and recursively-nested objects. Designed for
 * the section editor — round-trips the values that ConfigEntry forms
 * read and write — not as a general YAML parser.
 */

import { formatYamlScalar, serializeYamlValues } from "./yaml-serialize.js";

/**
 * Identifier alphabet ESPHome accepts for top-level / nested config
 * keys. Centralised so the parse and write paths stay in lockstep —
 * if the schema ever broadens (e.g. hyphenated or namespaced keys),
 * both sides change at one site instead of drifting silently.
 */
const KEY_PATTERN = "[a-zA-Z_][a-zA-Z0-9_]*";

/**
 * Match the inline-key form on a YAML list-item line
 * (`  - platform: esphome`). Capture group 1 is the key.
 *
 * Used by `parseYamlSectionValues` (to read the inline key into
 * the form values) and by `updateSectionInYaml` (to drop that
 * same key from the values before re-serializing the body, so it
 * isn't emitted twice). The two call sites must agree on what
 * "inline key" means; sharing the regex makes that a compile-time
 * fact.
 */
const LIST_ITEM_INLINE_KEY_RE = new RegExp(
  `^\\s+-\\s+(${KEY_PATTERN}):\\s*(.*)$`,
);

const childRegexFor = (indent: string) =>
  new RegExp(`^${indent}(${KEY_PATTERN}):\\s*(.*)$`);

// Intentionally permissive — the body after `- ` can be any
// scalar (string with spaces, number, !secret reference) and we
// just round-trip it. Validating the leading-token shape here
// would over-match `KEY_PATTERN`'s purpose; that constraint
// applies only to dict keys.
const listItemRegexFor = (indent: string) =>
  new RegExp(`^${indent}  -\\s+(.*)$`);

const stripQuotes = (s: string): string => {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
};

const parseScalar = (raw: string): unknown => {
  const v = stripQuotes(raw);
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
};

const parseFlowList = (raw: string): string[] => {
  const inner = raw.slice(1, -1).trim();
  if (inner === "") return [];
  return inner.split(",").map((p) => stripQuotes(p.trim()));
};

const collectBlockListItems = (
  lines: string[],
  startIdx: number,
  prefix: string,
  itemRegex: RegExp,
): { items: string[]; endIdx: number } => {
  const items: string[] = [];
  let j = startIdx;
  for (; j < lines.length; j++) {
    if (lines[j].trim() === "") continue;
    if (!lines[j].startsWith(prefix)) break;
    const m = lines[j].match(itemRegex);
    if (!m) break;
    items.push(stripQuotes(m[1].trim()));
  }
  return { items, endIdx: j };
};

/**
 * Find the 0-indexed line where the named section begins.
 * If `fromLine` is provided, returns it (converted from 1-indexed).
 * Otherwise scans for `sectionKey:` at column 0.
 */
export function findSectionStart(
  lines: string[],
  sectionKey: string,
  fromLine?: number,
): number {
  if (fromLine !== undefined) return fromLine - 1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`${sectionKey}:`)) return i;
  }
  return -1;
}

/**
 * Parse the values inside a YAML section into a plain object.
 * Walks from `fromLine` (or the first `${sectionKey}:` line) and
 * stops at the next sibling section.
 */
export function parseYamlSectionValues(
  yaml: string,
  sectionKey: string,
  fromLine?: number,
): Record<string, unknown> {
  const lines = yaml.split("\n");
  // Null-prototype map so a YAML key like `__proto__` /
  // `constructor` / `prototype` lands as a normal own property
  // instead of mutating the inherited prototype chain — defends
  // against prototype-pollution via crafted YAML. ESPHome doesn't
  // use those names as legitimate keys, but the values map flows
  // into the form and into downstream code that does property
  // access; a null-prototype root keeps the dunder attempts inert.
  const values: Record<string, unknown> = Object.create(null);
  const startIdx = findSectionStart(lines, sectionKey, fromLine);
  if (startIdx < 0) return values;

  const isListItem = /^\s+-\s/.test(lines[startIdx]);
  const childIndent = isListItem ? "    " : "  ";
  const childRegex = childRegexFor(childIndent);

  // List-item form: the first child key may sit on the same line as
  // the leading dash (e.g. `  - platform: gpio\n    pin: 4`).
  if (isListItem) {
    const firstMatch = lines[startIdx].match(LIST_ITEM_INLINE_KEY_RE);
    if (firstMatch) {
      const raw = firstMatch[2].trim();
      if (raw !== "") values[firstMatch[1]] = parseScalar(raw);
    }
  }

  const listItemPrefix = `${childIndent}  - `;
  const listItemRegex = listItemRegexFor(childIndent);

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (isListItem) {
      if (/^\s+-\s/.test(line) || /^[a-zA-Z]/.test(line)) break;
    } else if (/^[a-zA-Z]/.test(line)) {
      break;
    }

    const match = line.match(childRegex);
    if (!match) continue;
    const key = match[1];
    const raw = match[2].trim();

    if (raw === "") {
      let peek = i + 1;
      while (peek < lines.length && lines[peek].trim() === "") peek++;
      if (peek >= lines.length) continue;
      const peekLine = lines[peek];

      if (peekLine.startsWith(listItemPrefix)) {
        const { items, endIdx } = collectBlockListItems(
          lines,
          i + 1,
          listItemPrefix,
          listItemRegex,
        );
        if (items.length > 0) {
          values[key] = items;
          i = endIdx - 1;
        }
        continue;
      }

      const nestedIndent = `${childIndent}  `;
      if (peekLine.startsWith(nestedIndent)) {
        const result = parseNestedBlock(lines, i + 1, nestedIndent);
        if (Object.keys(result.values).length > 0) {
          values[key] = result.values;
        }
        i = result.endIdx - 1;
      }
      continue;
    }

    if (raw.startsWith("[") && raw.endsWith("]")) {
      values[key] = parseFlowList(raw);
      continue;
    }
    values[key] = parseScalar(raw);
  }

  return values;
}

/** Recursively parse a nested YAML block at the given indent. */
function parseNestedBlock(
  lines: string[],
  startIdx: number,
  indent: string,
): { values: Record<string, unknown>; endIdx: number } {
  const childRegex = childRegexFor(indent);
  const listItemPrefix = `${indent}  - `;
  const listItemRegex = listItemRegexFor(indent);
  // Null-prototype — same prototype-pollution defense as the
  // top-level `parseYamlSectionValues` map; nested blocks recurse
  // into here so they need the same safety.
  const values: Record<string, unknown> = Object.create(null);
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (!line.startsWith(indent)) break;
    const match = line.match(childRegex);
    if (!match) {
      i++;
      continue;
    }
    const key = match[1];
    const raw = match[2].trim();

    if (raw === "") {
      let peek = i + 1;
      while (peek < lines.length && lines[peek].trim() === "") peek++;
      if (peek < lines.length && lines[peek].startsWith(listItemPrefix)) {
        const { items, endIdx } = collectBlockListItems(
          lines,
          i + 1,
          listItemPrefix,
          listItemRegex,
        );
        values[key] = items;
        i = endIdx;
        continue;
      }
      const deeper = `${indent}  `;
      if (peek < lines.length && lines[peek].startsWith(deeper)) {
        const sub = parseNestedBlock(lines, i + 1, deeper);
        if (Object.keys(sub.values).length > 0) values[key] = sub.values;
        i = sub.endIdx;
        continue;
      }
      i++;
      continue;
    }

    if (raw.startsWith("[") && raw.endsWith("]")) {
      values[key] = parseFlowList(raw);
    } else {
      values[key] = parseScalar(raw);
    }
    i++;
  }
  return { values, endIdx: i };
}

/** Find the 0-indexed line range [start, end) for a section. */
export function findSectionRange(
  lines: string[],
  sectionKey: string,
  fromLine?: number,
): { start: number; end: number } {
  const start = findSectionStart(lines, sectionKey, fromLine);
  if (start < 0) return { start: -1, end: -1 };

  const isListItem = /^\s+-\s/.test(lines[start]);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isListItem) {
      if (/^\s+-\s/.test(lines[i]) || /^[a-zA-Z]/.test(lines[i])) {
        end = i;
        break;
      }
    } else if (/^[a-zA-Z]/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** Replace the body of a section in a YAML document with `values`. */
export function updateSectionInYaml(
  yaml: string,
  sectionKey: string,
  values: Record<string, unknown>,
  fromLine?: number,
): string {
  const lines = yaml.split("\n");
  const { start, end } = findSectionRange(lines, sectionKey, fromLine);
  if (start < 0) return yaml;

  const isListItem = /^\s+-\s/.test(lines[start]);
  const childIndent = isListItem ? "    " : "  ";
  let toSerialize = values;
  let dashLine = lines[start];
  if (isListItem) {
    // List items can carry a key/value inline with the dash
    // (`- platform: esphome`). `parseYamlSectionValues` reads that
    // key into `values`; if we re-serialize it under the dash
    // line it gets emitted twice — once on the dash, once as a
    // regular child — the visible
    // `- platform: esphome\n    platform: esphome` duplicate users
    // reported as "Save adds another esphome item".
    //
    // The form is the authoritative source for the inline key:
    // rewrite the dash line to whatever the form holds, then drop
    // that key from the body so it isn't emitted twice. Two
    // shapes this handles:
    //
    //   - dash already carried a value, form unchanged: rewrite
    //     yields the same line (no diff).
    //   - dash was empty (`- platform:`) and form has a value:
    //     rewrite produces `- platform: esphome` instead of
    //     leaving an empty dash with a duplicate child below.
    //
    // Only acts on inline-able scalar values — a complex (object
    // / list) form value can't sit on the dash line, so we leave
    // the dash alone and emit the value normally in the body.
    // Same regex `parseYamlSectionValues` reads so the two sides
    // stay in lockstep on what counts as an inline key.
    const inlineMatch = dashLine.match(LIST_ITEM_INLINE_KEY_RE);
    if (inlineMatch) {
      const inlineKey = inlineMatch[1];
      if (
        inlineKey in values &&
        _isInlinableScalar(values[inlineKey])
      ) {
        const dashPrefix = dashLine.match(/^(\s+-\s+)/)?.[1] ?? "  - ";
        dashLine = `${dashPrefix}${inlineKey}: ${formatYamlScalar(
          values[inlineKey],
        )}`;
        const { [inlineKey]: _omit, ...rest } = values;
        toSerialize = rest;
      }
    }
  }
  const newLines = [dashLine, ...serializeYamlValues(toSerialize, childIndent)];
  lines.splice(start, end - start, ...newLines);
  return lines.join("\n");
}

/**
 * True when *value* can be emitted on the dash line as
 * `- key: <value>`. Strings, numbers, booleans qualify; objects,
 * arrays, null, and undefined need the body representation.
 */
function _isInlinableScalar(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}

/**
 * Remove a section (top-level block or single list item) from a YAML
 * document. When deleting a list item leaves its parent block with
 * nothing but blank lines, the empty parent is removed too — both to
 * avoid a stray `sensor:` that ESPHome rejects, and to keep the
 * resulting YAML tidy.
 */
export function removeSectionFromYaml(
  yaml: string,
  sectionKey: string,
  fromLine?: number,
): string {
  const lines = yaml.split("\n");
  const { start, end } = findSectionRange(lines, sectionKey, fromLine);
  if (start < 0) return yaml;

  const isListItem = /^\s+-\s/.test(lines[start]);
  lines.splice(start, end - start);

  if (isListItem) {
    // Walk backwards to the parent top-level key; if nothing but
    // blanks remain between it and the next sibling, drop it too.
    let parentIdx = start - 1;
    while (parentIdx >= 0 && !/^[a-zA-Z]/.test(lines[parentIdx])) {
      parentIdx--;
    }
    if (parentIdx >= 0) {
      let hasContent = false;
      let parentEnd = lines.length;
      for (let i = parentIdx + 1; i < lines.length; i++) {
        if (/^[a-zA-Z]/.test(lines[i])) {
          parentEnd = i;
          break;
        }
        if (lines[i].trim() !== "") {
          hasContent = true;
          break;
        }
      }
      if (!hasContent) {
        lines.splice(parentIdx, parentEnd - parentIdx);
      }
    }
  }

  return lines.join("\n");
}
