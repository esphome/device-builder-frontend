/**
 * Structural reader: parses a YAML section into form values plus the
 * per-key source spans the splice writer needs. The mutually-recursive
 * list / mapping / nested-block dispatch lives here. Sits on the lexer,
 * list-scanner, scalar, and splice layers; consumed by the mutation
 * facade in yaml-section-values.ts.
 */

import { ESPHOME_YAML_INDENT } from "./esphome-yaml-lang.js";
import { LIST_SECTIONS } from "./section-entry-overrides.js";
import {
  blockScalarValue,
  isEditableLambdaBlock,
  lambdaValueFromBlock,
} from "./yaml-block-scalar-value.js";
import { parseFlowList, parseScalar, splitInlineComment } from "./yaml-scalar.js";
import {
  _detectListItemChildIndent,
  _detectSectionChildIndent,
  _leadingIndent,
  _skipBlankAndCommentLines,
  childRegexFor,
  isBlankOrCommentLine,
  isChildListItemLine,
  isCommentLine,
  isListItemLine,
  KEY_PATTERN,
  LIST_ITEM_BARE_DASH_RE,
  LIST_ITEM_INLINE_KEY_RE,
  LIST_ITEM_START_RE,
  listItemRegexFor,
  parseBlockScalarHeader,
  TOP_LEVEL_KEY_START_RE,
} from "./yaml-section-lexer.js";
import {
  _detectFirstDashIndent,
  _matchFlatMappingField,
  _scanValueBlock,
  collectBlockListItems,
  parseFlatMappingField,
} from "./yaml-section-list.js";
import { type KeySpan, type ParsedSection } from "./yaml-section-splice.js";
import { YamlRawValue } from "./yaml-serialize.js";

/**
 * Dispatch a YAML list block (``key:\n  - …``) into the right
 * value shape: structured array of mappings for editor-friendly
 * lists (``esphome.devices`` / ``esphome.areas``), ``YamlRawValue``
 * for complex automation triggers, or ``string[]`` for scalar
 * lists. Shared between the top-level and nested-block parsers
 * so both surfaces agree on the dispatch.
 *
 * ``parentIndent`` is the indent of the parent KEY (the one whose
 * value is the list). The dash and child indents are detected
 * from the first list-item line so 4-space (or other consistent)
 * user YAML round-trips correctly — the editor's canonical
 * 2-space emit applies on save, but reads accept any indent the
 * user chose.
 *
 * Returns ``endIdx`` — the line after the block ends — so callers
 * can fast-forward their loop index. ``isEmptyScalarList`` lets
 * the top-level caller preserve its existing "skip the assignment
 * for an empty scalar list" semantic.
 */
const parseListBlock = (
  lines: string[],
  startIdx: number,
  parentIndent: string
): {
  value: YamlRawValue | Record<string, unknown>[] | string[];
  endIdx: number;
  isEmptyScalarList: boolean;
} => {
  const canonicalDashIndent = `${parentIndent}${ESPHOME_YAML_INDENT}`;
  const { dashIndent, firstDashIdx } = _detectFirstDashIndent(
    lines,
    startIdx,
    canonicalDashIndent
  );
  const childIndent =
    _detectListItemChildIndent(lines, firstDashIdx + 1, dashIndent) ??
    `${dashIndent}${ESPHOME_YAML_INDENT}`;
  const { endIdx, isComplex } = _scanValueBlock(lines, startIdx, parentIndent);

  // Complex blocks are anything beyond a flat scalar list (block
  // scalars, automation triggers, mapping items). Try the
  // structured-mapping parse first (``esphome.devices`` /
  // ``esphome.areas``); fall through to ``YamlRawValue`` for
  // shapes the editor can't round-trip.
  if (isComplex) {
    const mapping = collectBlockListMappings(lines, startIdx, dashIndent, childIndent);
    if (mapping) {
      return {
        value: mapping.items,
        endIdx: mapping.endIdx,
        isEmptyScalarList: false,
      };
    }
    return {
      value: new YamlRawValue(lines.slice(startIdx, endIdx)),
      endIdx,
      isEmptyScalarList: false,
    };
  }

  // Flat scalar list (``packages: [- a, - b]``). Both the
  // startsWith prefix and the line regex use the detected
  // ``dashIndent`` so 4-space user YAMLs round-trip — the older
  // ``listItemRegexFor(parentIndent)`` hardcoded the canonical
  // 2-space step and silently dropped scalar lists otherwise.
  const { items, endIdx: scalarEndIdx } = collectBlockListItems(
    lines,
    startIdx,
    `${dashIndent}- `,
    listItemRegexFor(dashIndent)
  );
  return {
    value: items,
    endIdx: scalarEndIdx,
    isEmptyScalarList: items.length === 0,
  };
};

/**
 * Walk follow-up sub-key lines under a list-item dash and merge
 * them into *item*. Stops at the next sibling dash, blank-then-EOF,
 * or a back-out. Returns the line index after the last sub-key,
 * or ``null`` if anything outside the flat-mapping contract turned
 * up (line strictly deeper than ``childIndent`` ⇒ nested mapping;
 * unmatched key shape; dotted key; block scalar; empty raw).
 * Mutates *item* in place — keeps the caller's outer loop from
 * having to thread two return values.
 */
const _parseItemSubKeys = (
  lines: string[],
  startIdx: number,
  childIndent: string,
  childRe: RegExp,
  item: Record<string, unknown>
): number | null => {
  let j = startIdx;
  while (j < lines.length) {
    const sub = lines[j];
    if (isBlankOrCommentLine(sub)) {
      j++;
      continue;
    }
    if (!sub.startsWith(childIndent)) break;
    // Strictly deeper than ``childIndent`` ⇒ nested mapping/list
    // under a sub-key — bail.
    if (sub.startsWith(`${childIndent} `)) return null;
    const field = _matchFlatMappingField(sub, childRe);
    if (!field) return null;
    item[field.key] = field.value;
    j++;
  }
  return j;
};

/**
 * Collect a YAML list whose items are flat key:value mappings —
 * ``esphome.devices`` / ``esphome.areas`` and similar
 * ``multi_value=true`` schema entries — as ``Record<string, unknown>[]``.
 * Each item starts with ``<dashIndent>-`` and continues at
 * ``<childIndent>`` (one level deeper than the dash). Returns
 * ``null`` when the block can't be parsed cleanly into a structured
 * array — caller should fall back to ``YamlRawValue`` so complex
 * shapes (block scalars, automation triggers, nested mappings)
 * still round-trip.
 *
 * The helper is deliberately conservative: false negatives drop
 * back to the existing raw path (no behaviour change), false
 * positives would silently lose user content on save.
 */
const collectBlockListMappings = (
  lines: string[],
  startIdx: number,
  dashIndent: string,
  childIndent: string
): { items: Record<string, unknown>[]; endIdx: number } | null => {
  const headerRe = new RegExp(`^${dashIndent}-\\s+(${KEY_PATTERN}):\\s*(.*)$`);
  const childRe = new RegExp(`^${childIndent}(${KEY_PATTERN}):\\s*(.*)$`);

  /**
   * Parse one list item starting at *at* (the dash line). Returns
   * the new line index on success, ``null`` to bail. Bare-dash
   * items (``${dashIndent}-`` followed by EOL or only whitespace)
   * are the serializer's placeholder for a freshly-added Add row
   * the user saved before filling fields — we skip the header
   * parse and let the sub-key walk find zero follow-ups, so the
   * item stays ``{}`` and the row survives the round-trip. The
   * trailing-whitespace shape (``    -  ``) is what some editors
   * emit when the user's cursor lands on a fresh dash line, and
   * also what ``LIST_ITEM_BARE_DASH_RE`` already accepts as a
   * complexity signal — using the same regex here keeps the two
   * predicates in lockstep.
   */
  const parseItem = (
    at: number
  ): { item: Record<string, unknown>; endIdx: number } | null => {
    // Same null-prototype defence as the surrounding parser — see
    // the comment in ``parseYamlSectionValues``.
    const item: Record<string, unknown> = Object.create(null);
    let firstEmptyKey: string | null = null;
    if (!LIST_ITEM_BARE_DASH_RE.test(lines[at])) {
      const headerMatch = lines[at].match(headerRe);
      if (!headerMatch) return null;
      const headerKey = headerMatch[1];
      const headerRaw = headerMatch[2].trim();
      // ``- multiply: !lambda |-``: the body sits on the following
      // deeper-indented lines, so capture it here rather than letting
      // ``parseFlatMappingField`` mis-read the lone header as a scalar
      // and drop the body. Scoped to ``!lambda``; a bare ``- foo: |-``
      // (or ``- then:`` sequence) still bails to the whole-list
      // ``YamlRawValue`` fallback. Body extent is measured against the
      // dash key column (``dashIndent + "- "``); the detected
      // ``childIndent`` collapses onto the body indent when there are
      // no flat sibling sub-keys.
      const blockHeader = parseBlockScalarHeader(headerRaw);
      if (blockHeader) {
        if (!isEditableLambdaBlock(blockHeader)) return null;
        const { endIdx } = _scanValueBlock(
          lines,
          at + 1,
          `${dashIndent}${ESPHOME_YAML_INDENT}`
        );
        // A sibling sub-key after the lambda body would be lost by the
        // early return; bail to the whole-list YamlRawValue fallback
        // instead (this helper's conservative contract). Unreachable
        // with valid ESPHome YAML: filter/effect items are single-key.
        const peek = _skipBlankAndCommentLines(lines, endIdx);
        if (
          peek < lines.length &&
          _leadingIndent(lines[peek]).length > dashIndent.length
        ) {
          return null;
        }
        item[headerKey] = lambdaValueFromBlock(lines.slice(at + 1, endIdx));
        return { item, endIdx };
      }
      const header = parseFlatMappingField(headerKey, headerRaw);
      if (!header) return null;
      item[header.key] = header.value;
      // ``- effect_id:`` with no value may be a polymorphic single-
      // key item — the empty value's real shape sits as a nested
      // mapping at strictly deeper indent than the flat sub-key
      // level. Remember the key so the next-line peek below can
      // upgrade the value from ``null`` to ``{params}``.
      if (header.value === null) firstEmptyKey = header.key;
    }
    // Polymorphic branch (#941, light ``effects:``): a dash header
    // with a single-key empty value can carry its params at strictly
    // deeper indent than the dash-line key column. The threshold is
    // ``dashIndent.length + 2`` (the column of the key after ``- ``),
    // NOT the detected ``childIndent`` — the latter collapses to the
    // deeper indent when no flat sibling exists, breaking the
    // discriminator between "nested under empty key" and "flat sibling
    // sub-keys". Bail on list-shaped nested content (``- then:`` →
    // ``  - logger.log:``) so automation handlers still round-trip via
    // YamlRawValue.
    if (firstEmptyKey !== null) {
      const dashKeyColumn = dashIndent.length + 2;
      const peek = _skipBlankAndCommentLines(lines, at + 1);
      if (peek < lines.length) {
        const peekLead = _leadingIndent(lines[peek]);
        if (peekLead.length > dashKeyColumn) {
          if (lines[peek].slice(peekLead.length).startsWith("-")) return null;
          const sub = parseNestedBlock(lines, at + 1, peekLead);
          if (Object.keys(sub.values).length > 0) {
            item[firstEmptyKey] = sub.values;
          }
          return { item, endIdx: sub.endIdx };
        }
      }
    }
    const after = _parseItemSubKeys(lines, at + 1, childIndent, childRe, item);
    return after === null ? null : { item, endIdx: after };
  };

  const items: Record<string, unknown>[] = [];
  let j = startIdx;
  while (j < lines.length) {
    if (isBlankOrCommentLine(lines[j])) {
      j++;
      continue;
    }
    if (!isListItemLine(lines[j], dashIndent)) break;
    const parsed = parseItem(j);
    if (!parsed) return null;
    items.push(parsed.item);
    j = parsed.endIdx;
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
  fromLine?: number
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
 * List-item recognition uses the loose `LIST_ITEM_START_RE`
 * (`yaml-section-lexer.ts`) so the parser agrees with what
 * `updateSectionInYaml` (`yaml-section-values.ts`) can emit (including
 * the bare `  -` dash that the non-scalar inline-value path produces).
 * The parser must agree with the serializer; if you tighten one,
 * tighten both.
 */
export function parseYamlSectionValues(
  yaml: string,
  sectionKey: string,
  fromLine?: number
): Record<string, unknown> {
  return parseSectionCore(yaml.split("\n"), sectionKey, fromLine).values;
}

/**
 * Parse a section into values plus each top-level key's source-line
 * span, so `updateSectionInYaml` can copy untouched keys back verbatim
 * rather than re-serialize the whole section (#1227). Spans are built
 * in the value-parse walk so the two can't drift.
 */
export function parseSectionCore(
  lines: string[],
  sectionKey: string,
  fromLine?: number
): ParsedSection {
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
  const spans = new Map<string, KeySpan>();
  const comments = new Map<string, string>();
  // leadStart is finalised by the post-loop pass below.
  const recordSpan = (key: string, start: number, end: number): void => {
    spans.set(key, { start, end, leadStart: start });
  };
  const startIdx = findSectionStart(lines, sectionKey, fromLine);
  if (startIdx < 0) {
    return { values, spans, comments, childIndent: "", isListItem: false, startIdx };
  }

  const isListItem = LIST_ITEM_START_RE.test(lines[startIdx]);
  // Detect the indent the user actually picked for this
  // section's children so 4-space (or other consistent) YAMLs
  // round-trip through the editor without coming back empty.
  // Falls back to ESPHome's canonical 2-space step on empty
  // sections.
  const childIndent = _detectSectionChildIndent(lines, startIdx, isListItem);
  const childRegex = childRegexFor(childIndent);

  // Top-level list-bodied section (globals): the item array lives at
  // [sectionKey], where the wrapper's multi_value entry reads it.
  if (!isListItem && LIST_SECTIONS.has(sectionKey)) {
    const peek = _skipBlankAndCommentLines(lines, startIdx + 1);
    if (peek < lines.length && isChildListItemLine(lines[peek], childIndent)) {
      values[sectionKey] = parseListBlock(lines, startIdx + 1, childIndent).value;
      // No per-key spans — `updateSectionInYaml` re-emits this whole
      // list through its dedicated LIST_SECTIONS branch.
      return { values, spans, comments, childIndent, isListItem, startIdx };
    }
  }

  // List-item form: the first child key may sit on the same line as
  // the leading dash (e.g. `  - platform: gpio\n    pin: 4`). No span
  // is recorded — it rides on the dash line.
  if (isListItem) {
    const firstMatch = lines[startIdx].match(LIST_ITEM_INLINE_KEY_RE);
    if (firstMatch) {
      const raw = firstMatch[2].trim();
      if (raw !== "") {
        const { comment } = splitInlineComment(raw);
        if (comment) comments.set(firstMatch[1], comment);
        values[firstMatch[1]] = parseScalar(raw);
      }
    }
  }

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
    if (isBlankOrCommentLine(line)) continue;
    if (isListItem) {
      const dashMatch = line.match(/^(\s*)-(\s|$)/);
      if (dashMatch && dashMatch[1].length === siblingDashIndent) break;
      if (TOP_LEVEL_KEY_START_RE.test(line)) break;
    } else if (TOP_LEVEL_KEY_START_RE.test(line)) {
      break;
    }

    const match = line.match(childRegex);
    if (!match) continue;
    const key = match[1];
    const raw = match[2].trim();

    // Direct block scalar: `key: |-` (or `|`, `>`, `>-`, `|+`,
    // `>+`), optionally tagged (`key: !lambda |-`). The header sits
    // on this line; the body lines are indented underneath. Without
    // this branch the parser would store `raw` as a literal string
    // `"|-"` / `"!lambda |-"` and drop the body; the serializer
    // would then quote it and corrupt the field. A `!lambda` tag
    // becomes an editable `LambdaValue`; anything else round-trips
    // through `YamlRawValue` (header replayed on serialize).
    const blockHeader = parseBlockScalarHeader(raw);
    if (blockHeader) {
      const { endIdx } = _scanValueBlock(lines, i + 1, childIndent);
      values[key] = blockScalarValue(blockHeader, raw, lines.slice(i + 1, endIdx));
      recordSpan(key, i, endIdx);
      i = endIdx - 1;
      continue;
    }

    if (raw === "") {
      const peek = _skipBlankAndCommentLines(lines, i + 1);
      if (peek >= lines.length) continue;
      const peekLine = lines[peek];

      if (isChildListItemLine(peekLine, childIndent)) {
        const { value, endIdx, isEmptyScalarList } = parseListBlock(
          lines,
          i + 1,
          childIndent
        );
        if (!isEmptyScalarList) {
          values[key] = value;
          recordSpan(key, i, endIdx);
          i = endIdx - 1;
        }
        continue;
      }

      // Read the deeper indent from the peek line itself so a
      // user-typed 4-space file recurses correctly.
      const peekLead = _leadingIndent(peekLine);
      if (peekLead.length > childIndent.length) {
        const result = parseNestedBlock(lines, i + 1, peekLead);
        if (Object.keys(result.values).length > 0) {
          values[key] = result.values;
          recordSpan(key, i, result.endIdx);
        }
        i = result.endIdx - 1;
      }
      continue;
    }

    // Split a trailing inline comment off before the flow-list test
    // (`[a, b] # c` doesn't end with `]`) and before scalar parsing,
    // and record it so an edit can re-append it (#1235).
    const { value: scalar, comment } = splitInlineComment(raw);
    if (comment) comments.set(key, comment);
    if (scalar.startsWith("[") && scalar.endsWith("]")) {
      values[key] = parseFlowList(scalar);
      recordSpan(key, i, i + 1);
      continue;
    }
    values[key] = parseScalar(scalar);
    recordSpan(key, i, i + 1);
  }

  // A multi-line value's scanners skip trailing blank / sibling-level
  // comment lines, so the recorded `end` can swallow a comment that
  // really leads the NEXT key — and editing this key would then drop
  // it. Pull the trailing run off the span so it folds into the next
  // key's leadStart below. Only when the run actually holds a comment:
  // a pure-blank run (the file's trailing newline, a `|+` keep) stays
  // with the value so byte-identical no-op saves don't lose it. The
  // indent guard keeps deeper block-scalar literal text in the value
  // (#1227).
  for (const span of spans.values()) {
    const low = span.start + 1;
    let runStart = span.end;
    let hasComment = false;
    while (
      runStart > low &&
      isBlankOrCommentLine(lines[runStart - 1]) &&
      _leadingIndent(lines[runStart - 1]).length <= childIndent.length
    ) {
      runStart--;
      if (isCommentLine(lines[runStart])) hasComment = true;
    }
    if (hasComment) span.end = runStart;
  }

  // Extend each span back over the blank/comment run directly above it
  // (bounded by the previous key's trimmed end), so leadStart/end
  // partition the body — a verbatim copy then neither drops nor
  // double-counts an inter-key comment.
  let prevEnd = startIdx + 1;
  for (const span of spans.values()) {
    let lead = span.start;
    while (lead > prevEnd && isBlankOrCommentLine(lines[lead - 1])) lead--;
    span.leadStart = lead;
    prevEnd = span.end;
  }

  return { values, spans, comments, childIndent, isListItem, startIdx };
}

/** Recursively parse a nested YAML block at the given indent. */
function parseNestedBlock(
  lines: string[],
  startIdx: number,
  indent: string
): { values: Record<string, unknown>; endIdx: number } {
  const childRegex = childRegexFor(indent);
  // Null-prototype — same prototype-pollution defense as the
  // top-level `parseYamlSectionValues` map; nested blocks recurse
  // into here so they need the same safety.
  const values: Record<string, unknown> = Object.create(null);
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlankOrCommentLine(line)) {
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
    // field written as `key: |-` (or `key: !lambda |-`) followed by
    // indented body round-trips via `LambdaValue` / `YamlRawValue`;
    // otherwise the body is dropped and `raw` survives as a stray
    // `"|-"` / `"!lambda |-"` string.
    const nestedBlockHeader = parseBlockScalarHeader(raw);
    if (nestedBlockHeader) {
      const { endIdx } = _scanValueBlock(lines, i + 1, indent);
      values[key] = blockScalarValue(nestedBlockHeader, raw, lines.slice(i + 1, endIdx));
      i = endIdx;
      continue;
    }

    if (raw === "") {
      const peek = _skipBlankAndCommentLines(lines, i + 1);
      // ``key:`` followed by a block list. Accept both the standard
      // (deeper-indent) and compact (same-indent) forms; the compact
      // shape is what ESPHome examples produce for short
      // ``calibration:`` / ``datapoints:`` lists.
      if (peek < lines.length && isChildListItemLine(lines[peek], indent)) {
        const { value, endIdx } = parseListBlock(lines, i + 1, indent);
        values[key] = value;
        i = endIdx;
        continue;
      }
      if (peek < lines.length) {
        const peekLead = _leadingIndent(lines[peek]);
        if (peekLead.length > indent.length) {
          const sub = parseNestedBlock(lines, i + 1, peekLead);
          if (Object.keys(sub.values).length > 0) values[key] = sub.values;
          i = sub.endIdx;
          continue;
        }
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
