/**
 * Structural reader: parses a YAML section into form values plus the
 * per-key source spans the splice writer needs. The mutually-recursive
 * list / mapping / nested-block dispatch lives in the sibling
 * yaml-section-block-reader.ts; this layer owns section discovery,
 * the top-level value walk, and span finalisation. Consumed by the
 * mutation facade in yaml-section-values.ts.
 */

import { LIST_SECTIONS } from "./section-entry-overrides.js";
import { blockScalarValue } from "./yaml-block-scalar-value.js";
import {
  parseFlowList,
  parseScalar,
  splitInlineComment,
  splitTrimmedInlineComment,
} from "./yaml-scalar.js";
import { parseListBlock, parseNestedBlock } from "./yaml-section-block-reader.js";
import {
  _detectSectionChildIndent,
  _leadingIndent,
  _skipBlankAndCommentLines,
  childRegexFor,
  isBlankOrCommentLine,
  isChildListItemLine,
  isCommentLine,
  LIST_ITEM_INLINE_KEY_RE,
  LIST_ITEM_START_RE,
  parseBlockScalarHeader,
  TOP_LEVEL_KEY_START_RE,
} from "./yaml-section-lexer.js";
import { _blockScalarBodyEnd } from "./yaml-section-list.js";
import { type KeyMeta, type ParsedSection } from "./yaml-section-splice.js";

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
  const keys = new Map<string, KeyMeta>();
  // leadStart is finalised by the post-loop pass below. A fresh record per
  // occurrence: a duplicate key re-assigns the value, and stale comment /
  // list / flow metadata must not survive it.
  const recordKey = (key: string, start: number, end: number): KeyMeta => {
    const meta: KeyMeta = { span: { start, end, leadStart: start } };
    keys.set(key, meta);
    return meta;
  };
  const startIdx = findSectionStart(lines, sectionKey, fromLine);
  if (startIdx < 0) {
    return { values, keys, childIndent: "", isListItem: false, startIdx };
  }

  const isListItem = LIST_ITEM_START_RE.test(lines[startIdx]);
  // Detect the indent the user actually picked for this
  // section's children so 4-space (or other consistent) YAMLs
  // round-trip through the editor without coming back empty.
  // Falls back to ESPHome's canonical 2-space step on empty
  // sections.
  const childIndent = _detectSectionChildIndent(lines, startIdx, isListItem);
  const childRegex = childRegexFor(childIndent);

  // Parse a ``key:``-with-nested-mapping value: the block on the lines after
  // *afterIdx* indented deeper than this section's child column. Returns
  // ``null`` when there's no such block. Shared by the dash-line inline key
  // and the in-loop ``key:`` paths so both read a nested mapping identically.
  const readNestedMappingAfter = (
    afterIdx: number
  ): { values: Record<string, unknown>; endIdx: number } | null => {
    const peek = _skipBlankAndCommentLines(lines, afterIdx);
    if (peek >= lines.length) return null;
    const peekLead = _leadingIndent(lines[peek]);
    if (peekLead.length <= childIndent.length) return null;
    return parseNestedBlock(lines, afterIdx, peekLead);
  };

  // Top-level list-bodied section (globals): the item array lives at
  // [sectionKey], where the wrapper's multi_value entry reads it.
  if (!isListItem && LIST_SECTIONS.has(sectionKey)) {
    // Peek and parse against the header's own indent, not the detected
    // child indent: a zero-indented sequence puts its dashes at the
    // header's column, below the child-indent fallback.
    const headerIndent = _leadingIndent(lines[startIdx]);
    const peek = _skipBlankAndCommentLines(lines, startIdx + 1);
    if (peek < lines.length && isChildListItemLine(lines[peek], headerIndent)) {
      values[sectionKey] = parseListBlock(lines, startIdx + 1, headerIndent).value;
      // No per-key spans — `updateSectionInYaml` re-emits this whole
      // list through its dedicated LIST_SECTIONS branch.
      return { values, keys, childIndent, isListItem, startIdx };
    }
  }

  // List-item form: the first child key may sit on the same line as
  // the leading dash (e.g. `  - platform: gpio\n    pin: 4`). No span
  // is recorded — it rides on the dash line.
  if (isListItem) {
    const firstMatch = lines[startIdx].match(LIST_ITEM_INLINE_KEY_RE);
    if (firstMatch) {
      // Re-read the value WITH its leading whitespace (the shared regex's
      // ``\s*`` drops it) so ``splitInlineComment`` can tell a real comment
      // (``#`` after whitespace) from a value that merely starts with ``#``
      // (``- file:#fragment``). The first ``:`` after the dash is the key's.
      const head = lines[startIdx];
      const afterColon = head.slice(head.indexOf(":", head.indexOf("-")) + 1);
      const { value: rawValue, comment } = splitInlineComment(afterColon);
      const scalar = rawValue.trim();
      if (scalar !== "") {
        if (comment) keys.set(firstMatch[1], { comment });
        values[firstMatch[1]] = parseScalar(scalar);
      } else {
        // No scalar: the key's value is the nested mapping below. It rides on
        // the dash line, so the main loop (which starts under it) never sees
        // it (#1389). A standalone comment is dropped, as the rewrite does.
        const sub = readNestedMappingAfter(startIdx + 1);
        if (sub && Object.keys(sub.values).length > 0) values[firstMatch[1]] = sub.values;
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
      const endIdx = _blockScalarBodyEnd(lines, i + 1, childIndent.length);
      values[key] = blockScalarValue(blockHeader, raw, lines.slice(i + 1, endIdx));
      recordKey(key, i, endIdx);
      // Auto-increment ``for`` loop: resume so the next ``i++`` lands on endIdx.
      i = endIdx - 1;
      continue;
    }

    // Split a trailing inline comment off before the empty test (a
    // comment-only value ``key: # note`` is an empty value to the loader,
    // #1385), the flow-list test (`[a, b] # c` doesn't end with `]`), and
    // scalar parsing — and record it so an edit can re-append it (#1235).
    const { value: scalar, comment } = splitTrimmedInlineComment(raw);
    if (scalar === "") {
      const peek = _skipBlankAndCommentLines(lines, i + 1);
      if (peek < lines.length && isChildListItemLine(lines[peek], childIndent)) {
        const { value, endIdx, isEmptyScalarList, listSource } = parseListBlock(
          lines,
          i + 1,
          childIndent
        );
        if (!isEmptyScalarList) {
          values[key] = value;
          const meta = recordKey(key, i, endIdx);
          if (listSource) meta.listSource = listSource;
          if (comment) meta.comment = comment;
          i = endIdx - 1;
        }
        continue;
      }

      // Nested mapping under ``key:`` (deeper indent read from the block
      // itself so a user-typed 4-space file recurses correctly). No block
      // — or a comment-only one — parses to null but is still recorded
      // WITH a span. If the bare key were dropped instead, its source
      // line would be invisible to the splice writer, which would then
      // append a second ``key:`` when the form supplies the value while
      // the original line — outside every span — survives the splice.
      const result = readNestedMappingAfter(i + 1);
      const endIdx = result?.endIdx ?? i + 1;
      values[key] =
        result && Object.keys(result.values).length > 0 ? result.values : null;
      const meta = recordKey(key, i, endIdx);
      if (comment) meta.comment = comment;
      i = endIdx - 1;
      continue;
    }

    if (scalar.startsWith("[") && scalar.endsWith("]")) {
      values[key] = parseFlowList(scalar);
      const meta = recordKey(key, i, i + 1);
      meta.flowList = true;
      if (comment) meta.comment = comment;
      continue;
    }
    values[key] = parseScalar(scalar);
    const meta = recordKey(key, i, i + 1);
    if (comment) meta.comment = comment;
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
  for (const { span } of keys.values()) {
    if (!span) continue;
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
  for (const { span } of keys.values()) {
    if (!span) continue;
    let lead = span.start;
    while (lead > prevEnd && isBlankOrCommentLine(lines[lead - 1])) lead--;
    span.leadStart = lead;
    prevEnd = span.end;
  }

  return { values, keys, childIndent, isListItem, startIdx };
}
