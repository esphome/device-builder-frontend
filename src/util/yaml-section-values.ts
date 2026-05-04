/**
 * Parse and rewrite key: value pairs in a section of a YAML document.
 *
 * Supports scalars (quoted/unquoted, booleans), block lists of scalars,
 * flow lists (`[a, b, c]`), and recursively-nested objects. Designed for
 * the section editor — round-trips the values that ConfigEntry forms
 * read and write — not as a general YAML parser.
 */

import {
  YamlRawValue,
  formatYamlScalar,
  serializeYamlValues,
} from "./yaml-serialize.js";

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

/**
 * Detect a YAML list-item start. Accepts both the standard
 * `  - <content>` form and the bare `  -` (end-of-line) form
 * `updateSectionInYaml` emits when a list item's inline-keyed
 * value can't be represented inline (object / array / null).
 *
 * Loosened from a stricter `/^\s+-\s/` so the parser agrees with
 * what the serializer in this same module can emit. ESPHome's
 * own YAML output never produces a bare-`-` outside that
 * round-trip path, so this is the only realistic source.
 */
export const LIST_ITEM_START_RE = /^\s+-(\s|$)/;

/**
 * Block-scalar header on a YAML line: `key: |`, `key: |-`, `key: >`,
 * `key: >+`, optionally followed by a comment. The minimal parser
 * doesn't model block scalars; their presence is the canonical
 * "this value can't be round-tripped through `Record<string, unknown>`"
 * signal that triggers raw-line preservation.
 *
 * Anchored at the start with `^[^"']*:` so the `:` we match is the
 * key/value delimiter, not a `:` sitting inside a quoted string
 * value (`name: "weird: |"`). False positives are merely
 * conservative (they over-trigger raw mode, which is lossless),
 * but the anchor avoids the surprise of raw-mode kicking in on a
 * value the parser could otherwise round-trip.
 */
const BLOCK_SCALAR_RE = /^[^"']*:\s*[|>][-+]?\s*(?:#.*)?$/;

/**
 * Match an inline block-scalar marker — the part AFTER the colon
 * on a `key: |-` line, captured by the parser as `raw`. Used to
 * detect the direct-block-scalar shape (a key whose value is a
 * block scalar header rather than a list of items).
 */
const BLOCK_SCALAR_INLINE_RE = /^[|>][-+]?$/;

/**
 * Match a list item whose value is a key-style sub-dict header
 * (`- then:`, `- lambda:`, `- logger.log: pressed`,
 * `- switch.turn_on: relay`). The dash + key + colon shape is the
 * other "complex list item" signal alongside block scalars — the
 * follow-up lines under such a header carry the actual content,
 * which the simple `string[]` representation would silently drop.
 *
 * Key allows dots (and digits / underscores after the leading
 * letter) so dotted action names like `logger.log` /
 * `switch.turn_on` register as dict-style items. The simpler
 * bare-identifier form let those automations through as plain
 * scalars, which the serializer then quoted (`- "logger.log:
 * pressed"`), corrupting the YAML type.
 *
 * Allows zero trailing whitespace after the colon (header-only
 * line) AND content after it (`- lambda: |-`); both forms are
 * complex.
 */
const LIST_ITEM_DICT_KEY_RE = /^\s+-\s+[a-zA-Z_][\w.]*:(?:\s|$)/;

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
 * Scan forward from `startIdx` once, returning both the 0-indexed
 * line that ends the value-block under a key at `keyIndent` AND
 * whether the block carries shapes the minimal parser can't
 * round-trip.
 *
 * Block extent: every subsequent line that's either blank or
 * indented strictly deeper than `keyIndent`. The first non-blank
 * line at `keyIndent` (sibling key) or shallower (back-out)
 * terminates it; EOF is also a valid terminator.
 *
 * Complexity signals:
 *   1. A block-scalar header (`key: |`, `key: >-`) on any line.
 *      Block scalars span multiple physical lines, and the
 *      `string` parser would only capture the header.
 *   2. A list-item whose first token is a key-style header
 *      (`- then:`, `- lambda:`, `- logger.log: pressed`). The
 *      follow-up indented lines carry the actual content; the
 *      `string[]` parser would silently drop them.
 * Either signal triggers raw-line preservation for the whole
 * block. False negatives regress to the previous mangling
 * behaviour, so the regexes are deliberately permissive — false
 * positives merely over-preserve.
 *
 * Indent comparison is on space-only leading whitespace. ESPHome's
 * emitter never produces tabs and the parser's `LIST_ITEM_START_RE`
 * / `childRegexFor` already assume spaces, so a tab here is a sign
 * of YAML the rest of the parser also won't handle correctly.
 *
 * Single pass (rather than separate `_findValueBlockEnd` +
 * `_isComplexBlock` walks) so a section with many top-level keys
 * and 100+ line value-blocks doesn't pay 2x the line scans.
 */
const _scanValueBlock = (
  lines: string[],
  startIdx: number,
  keyIndent: string,
): { endIdx: number; isComplex: boolean } => {
  let isComplex = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const lead = line.match(/^ */)![0];
    if (lead.length <= keyIndent.length) return { endIdx: i, isComplex };
    if (!isComplex) {
      if (BLOCK_SCALAR_RE.test(line) || LIST_ITEM_DICT_KEY_RE.test(line)) {
        isComplex = true;
      }
    }
  }
  return { endIdx: lines.length, isComplex };
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
 *
 * List-item recognition uses the loose `LIST_ITEM_START_RE` so
 * the parser agrees with what `updateSectionInYaml` in this same
 * module can emit (including the bare `  -` dash that the
 * non-scalar inline-value path produces). The parser must agree
 * with the serializer; if you tighten one, tighten both.
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
  // against prototype-pollution via crafted YAML.
  //
  // Semantic change for downstream: the returned map (and the
  // nested blocks parsed via `parseNestedBlock`) have no
  // `Object.prototype` methods. `for ... in`, `Object.keys`,
  // spread, `JSON.stringify`, `in`, and direct property access
  // all behave identically — they read enumerable own properties,
  // not prototype-inherited ones — but `values.hasOwnProperty(k)`
  // would now throw. Use `Object.prototype.hasOwnProperty.call` if
  // you need that check on a downstream consumer.
  const values: Record<string, unknown> = Object.create(null);
  const startIdx = findSectionStart(lines, sectionKey, fromLine);
  if (startIdx < 0) return values;

  const isListItem = LIST_ITEM_START_RE.test(lines[startIdx]);
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
  // For list-item-rooted sections: only sibling dashes at the
  // SAME indentation as the leading dash terminate the section.
  // A nested list inside a value (`on_press:` → `      - lambda:`)
  // has a deeper dash indent — treating it as a sibling would
  // cut the section short and leave the nested content stranded
  // outside the splice range, which is what mangled saves of
  // template-button automations.
  const siblingDashIndent = isListItem
    ? (lines[startIdx].match(/^(\s*)-/) ?? ["", ""])[1].length
    : -1;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (isListItem) {
      const dashMatch = line.match(/^(\s*)-(\s|$)/);
      if (dashMatch && dashMatch[1].length === siblingDashIndent) break;
      if (/^[a-zA-Z]/.test(line)) break;
    } else if (/^[a-zA-Z]/.test(line)) {
      break;
    }

    const match = line.match(childRegex);
    if (!match) continue;
    const key = match[1];
    const raw = match[2].trim();

    // Direct block scalar: `key: |-` (or `|`, `>`, `>-`, `|+`,
    // `>+`). The header sits on this line; the body lines are
    // indented underneath. Without this branch the parser would
    // store `raw` as a literal string `"|-"` and drop the body —
    // the serializer would then quote `|-` (it starts with `-`)
    // and emit `key: "|-"`, corrupting any inline lambda /
    // multi-line scalar field. Capture the body lines as raw
    // and replay the inline header on serialize.
    if (BLOCK_SCALAR_INLINE_RE.test(raw)) {
      const { endIdx } = _scanValueBlock(lines, i + 1, childIndent);
      values[key] = new YamlRawValue(lines.slice(i + 1, endIdx), raw);
      i = endIdx - 1;
      continue;
    }

    if (raw === "") {
      let peek = i + 1;
      while (peek < lines.length && lines[peek].trim() === "") peek++;
      if (peek >= lines.length) continue;
      const peekLine = lines[peek];

      if (peekLine.startsWith(listItemPrefix)) {
        // Find the full extent of this key's value-block AND its
        // complexity in a single forward scan. Complexity can
        // hide on a follow-up body line — `      - lambda: |-`
        // looks parseable on its own; the next-line
        // `          some_code();` body is what triggers raw-mode.
        const { endIdx, isComplex } = _scanValueBlock(
          lines,
          i + 1,
          childIndent,
        );
        if (isComplex) {
          // Slice with `lines.slice(i + 1, endIdx)` to capture
          // the lines verbatim (with trailing blank lines
          // trimmed by `_scanValueBlock`'s "next non-blank line
          // at keyIndent or shallower" terminator).
          values[key] = new YamlRawValue(lines.slice(i + 1, endIdx));
          i = endIdx - 1;
          continue;
        }
        const { items, endIdx: listEndIdx } = collectBlockListItems(
          lines,
          i + 1,
          listItemPrefix,
          listItemRegex,
        );
        if (items.length > 0) {
          values[key] = items;
          i = listEndIdx - 1;
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

    // Direct block scalar at nested indent (same shape as the
    // top-level parser's branch — see comment there). A nested
    // field written as `key: |-` followed by indented body has
    // to round-trip via `YamlRawValue`; otherwise the body is
    // dropped and `raw` survives as a stray `"|-"` string.
    if (BLOCK_SCALAR_INLINE_RE.test(raw)) {
      const { endIdx } = _scanValueBlock(lines, i + 1, indent);
      values[key] = new YamlRawValue(lines.slice(i + 1, endIdx), raw);
      i = endIdx;
      continue;
    }

    if (raw === "") {
      let peek = i + 1;
      while (peek < lines.length && lines[peek].trim() === "") peek++;
      if (peek < lines.length && lines[peek].startsWith(listItemPrefix)) {
        // Same complex-block detection as the top-level parser:
        // block scalars or sub-dict list items under a key get
        // captured raw rather than mangled into `string[]`.
        const { endIdx, isComplex } = _scanValueBlock(lines, i + 1, indent);
        if (isComplex) {
          values[key] = new YamlRawValue(lines.slice(i + 1, endIdx));
          i = endIdx;
          continue;
        }
        const { items, endIdx: listEndIdx } = collectBlockListItems(
          lines,
          i + 1,
          listItemPrefix,
          listItemRegex,
        );
        values[key] = items;
        i = listEndIdx;
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

/**
 * Find the 0-indexed line range [start, end) for a section.
 *
 * For list-item-rooted sections, termination is on a sibling dash
 * at the SAME indent as the leading dash (or a top-level key) —
 * NOT just any indented dash. A nested list inside the section's
 * value (e.g. an automation list under `on_press:` whose dashes
 * sit deeper than the section's leading dash) is part of the
 * section, not a sibling, and clipping the range there leaves the
 * nested content outside the splice — which then survives the
 * save and re-appears as duplicate stale lines under the new
 * serialized output. That regression was visible as a template
 * button's `on_press` lambda body persisting verbatim after the
 * form-side save mangled the on_press header.
 */
export function findSectionRange(
  lines: string[],
  sectionKey: string,
  fromLine?: number,
): { start: number; end: number } {
  const start = findSectionStart(lines, sectionKey, fromLine);
  if (start < 0) return { start: -1, end: -1 };

  const isListItem = LIST_ITEM_START_RE.test(lines[start]);
  const siblingDashIndent = isListItem
    ? (lines[start].match(/^(\s*)-/) ?? ["", ""])[1].length
    : -1;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isListItem) {
      const dashMatch = lines[i].match(/^(\s*)-(\s|$)/);
      if (dashMatch && dashMatch[1].length === siblingDashIndent) {
        end = i;
        break;
      }
      if (/^[a-zA-Z]/.test(lines[i])) {
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

  const isListItem = LIST_ITEM_START_RE.test(lines[start]);
  const childIndent = isListItem ? "    " : "  ";
  let toSerialize = values;
  let dashLine = lines[start];
  if (isListItem) {
    // List items can carry a key/value inline with the dash
    // (`- platform: esphome`). `parseYamlSectionValues` reads
    // that key into `values`; if we re-serialize it under the
    // dash line it gets emitted twice — once on the dash, once
    // as a regular child — the visible
    // `- platform: esphome\n    platform: esphome` duplicate
    // users reported as "Save adds another esphome item".
    //
    // The form is the authoritative source for the inline key.
    // Three cases, all of which yield the inline key exactly
    // once in the output (or zero times when the form dropped
    // it):
    //
    //   1. inline key absent from form: dash kept as-is, body
    //      emitted normally. Original behaviour.
    //   2. form value is an inline-able scalar (string / number
    //      / boolean): rewrite the dash to carry the form's
    //      value, drop the key from the body. Handles the
    //      empty-inline (`- platform:`), stale-inline (form
    //      picked a different value), and trailing-comment
    //      (`- platform: # ...`) cases uniformly.
    //   3. form value is non-scalar (object / array / null /
    //      undefined): collapse the dash to bare `-` and let
    //      the body serializer emit the inline key at the
    //      child indent. The dash can't represent a multi-line
    //      value, so demoting to a bare list-item head is the
    //      only way to keep the inline key from appearing
    //      twice. For object / array values that produces an
    //      inline-key block under the dash; for null /
    //      undefined the serializer drops the key entirely
    //      (the "zero times" arm of the contract above).
    //
    // Same regex `parseYamlSectionValues` reads so the two
    // sides stay in lockstep on what counts as an inline key.
    const inlineMatch = dashLine.match(LIST_ITEM_INLINE_KEY_RE);
    if (inlineMatch) {
      const inlineKey = inlineMatch[1];
      // Own-property check, not `in`: callers can hand us a
      // regular `{}` from form-side spreads / `setIn`, where
      // `"constructor" in values` is `true` because every plain
      // object inherits from `Object.prototype`. Treating that as
      // "form set the key" would rewrite the dash from a
      // prototype-inherited value and lose the YAML's actual
      // inline content. (`Object.prototype.hasOwnProperty.call`
      // rather than `Object.hasOwn` for tsconfig-target reach.)
      if (Object.prototype.hasOwnProperty.call(values, inlineKey)) {
        // Single regex captures both the indentation up to the
        // dash and the trailing whitespace before the inline
        // key — `dashPrefix` (with the trailing space) is what
        // the rewrite path needs, and the indent alone is what
        // the bare-dash path needs.
        //
        // The match always succeeds in this branch: we entered
        // it via `LIST_ITEM_INLINE_KEY_RE`, which requires `\s+`
        // both before and after the dash, so `\s+-\s+` is
        // already true of `dashLine`. The non-null assertion
        // makes that invariant local.
        const dashPrefixMatch = dashLine.match(/^(\s+)-(\s+)/)!;
        const dashIndent = dashPrefixMatch[1];
        const dashPrefix = `${dashIndent}-${dashPrefixMatch[2]}`;
        if (_isInlinableScalar(values[inlineKey])) {
          dashLine = `${dashPrefix}${inlineKey}: ${formatYamlScalar(
            values[inlineKey],
          )}`;
          const { [inlineKey]: _omit, ...rest } = values;
          toSerialize = rest;
        } else {
          // Non-scalar form value: drop the inline key from the
          // dash and let the body serializer emit everything,
          // including the now-non-inline key.
          dashLine = `${dashIndent}-`;
        }
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

  const isListItem = LIST_ITEM_START_RE.test(lines[start]);
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
