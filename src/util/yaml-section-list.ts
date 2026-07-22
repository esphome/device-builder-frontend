/**
 * Block/list scanning primitives for the section reader: low-level
 * helpers that walk scalar list items, flat mapping fields inside list
 * items, and multi-line value blocks. Sits on the lexer + scalar
 * layers; called by yaml-section-reader.ts.
 */

import {
  coerceListScalar,
  isQuotedScalar,
  parseFlowList,
  parseScalar,
  splitInlineComment,
  stripQuotes,
} from "./yaml-scalar.js";
import {
  _leadingIndent,
  BLOCK_SCALAR_RE,
  endsBlockAtIndent,
  isBlankOrCommentLine,
  LIST_ITEM_BARE_DASH_RE,
  LIST_ITEM_DICT_KEY_RE,
  parseBlockScalarHeader,
} from "./yaml-section-lexer.js";

export const collectBlockListItems = (
  lines: string[],
  startIdx: number,
  prefix: string,
  itemRegex: RegExp
): { items: (string | number | boolean)[]; endIdx: number } => {
  const items: (string | number | boolean)[] = [];
  let j = startIdx;
  for (; j < lines.length; j++) {
    if (isBlankOrCommentLine(lines[j])) continue;
    if (!lines[j].startsWith(prefix)) break;
    const m = lines[j].match(itemRegex);
    if (!m) break;
    // Strip a trailing inline comment (``- 10 # note``) so the item
    // coerces and the form value isn't polluted with ``# ...`` text —
    // same rule as parseScalar (#1235). An edited list re-emits without
    // the comment; keeping it in the value corrupted it into the string
    // ``"10 # note"`` instead.
    const { value: raw } = splitInlineComment(m[1].trim());
    items.push(coerceListScalar(stripQuotes(raw), isQuotedScalar(raw)));
  }
  return { items, endIdx: j };
};

/**
 * Find the leading whitespace of the first list-item dash at or
 * after *startIdx*. Returns *fallback* when no dash is reachable
 * (the block is blank or terminates before any item) and the
 * 0-indexed line of the first dash so the caller can hand it to
 * :func:`_detectListItemChildIndent`.
 */
export const _detectFirstDashIndent = (
  lines: string[],
  startIdx: number,
  fallback: string
): { dashIndent: string; firstDashIdx: number } => {
  let firstDashIdx = startIdx;
  while (firstDashIdx < lines.length && isBlankOrCommentLine(lines[firstDashIdx])) {
    firstDashIdx++;
  }
  if (firstDashIdx >= lines.length) {
    return { dashIndent: fallback, firstDashIdx };
  }
  const dashIndent = lines[firstDashIdx].match(/^( *)-/)?.[1] ?? fallback;
  return { dashIndent, firstDashIdx };
};

/**
 * Parse a single ``key: value`` field of a flat-mapping list item
 * — used by ``collectBlockListMappings`` for both the inline header
 * (``- key: value``) and the follow-up child lines. Returns
 * ``null`` whenever the field carries anything outside the
 * mapping-list contract (dotted automation-trigger keys, empty
 * raw values that would open a nested mapping/list, block-scalar
 * headers). Callers translate ``null`` into "bail out, fall back
 * to YamlRawValue".
 */
export const parseFlatMappingField = (
  key: string,
  raw: string
): { key: string; value: unknown } | null => {
  // Dotted keys (``logger.log:``, ``switch.turn_on:``) are
  // automation-action shorthand — not flat-mapping fields. Bail
  // so the surrounding parser keeps the block as YamlRawValue
  // and the serializer doesn't quote the dotted key on save.
  if (key.includes(".")) return null;
  // Block-scalar headers (``key: |-``, ``key: !lambda |-``) stay
  // opaque here so the multi-line body round-trips: the inline
  // ``raw`` is only the header, the body sits on following lines
  // the caller captures. ``parseScalar("|-")`` would otherwise
  // return the literal string ``"|-"`` (or ``"!lambda |-"``).
  if (parseBlockScalarHeader(raw)) return null;
  // ``key:`` with no value is structurally ``{key: null}`` in YAML.
  // Recognising it here is what lets list-of-single-key-mappings
  // (light ``effects:``, sensor ``filters:``, any registry-shaped
  // field) round-trip through the section editor instead of
  // falling back to YamlRawValue. #941.
  if (raw === "") return { key, value: null };
  // Flow list inside a list-item mapping (``extras[].glyphs:
  // ["\U000F058F", ...]``). Strip a trailing comment first so the
  // ``[...]`` test fires; without this the array reads as a scalar string
  // and the multi_value field renders empty (device-builder#1232).
  const { value: scalar } = splitInlineComment(raw);
  if (scalar.startsWith("[") && scalar.endsWith("]")) {
    return { key, value: parseFlowList(scalar) };
  }
  return { key, value: parseScalar(raw) };
};

/**
 * Match *line* against *re* (one of the two ``key: value`` regexes
 * built by :func:`collectBlockListMappings`) and run the captured
 * key + raw value through :func:`parseFlatMappingField`. Returns
 * ``null`` for any failure — regex miss, dotted key, block scalar,
 * empty raw — which all share the same "bail out, fall back to
 * YamlRawValue" semantic at the caller. Centralised so the inline
 * header (``- key: value``) and child-line (``  key: value``)
 * paths share one match-and-validate step.
 */
export const _matchFlatMappingField = (
  line: string,
  re: RegExp
): { key: string; value: unknown } | null => {
  const m = line.match(re);
  return m ? parseFlatMappingField(m[1], m[2].trim()) : null;
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
export const _scanValueBlock = (
  lines: string[],
  startIdx: number,
  keyIndent: string
): { endIdx: number; isComplex: boolean } => {
  let isComplex = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (isBlankOrCommentLine(line)) continue;
    // Same-indent compact block-sequence + comment rules live in
    // ``endsBlockAtIndent`` (see the lexer).
    if (endsBlockAtIndent(line, keyIndent.length)) return { endIdx: i, isComplex };
    if (!isComplex) {
      if (
        BLOCK_SCALAR_RE.test(line) ||
        LIST_ITEM_DICT_KEY_RE.test(line) ||
        LIST_ITEM_BARE_DASH_RE.test(line)
      ) {
        isComplex = true;
      }
    }
  }
  return { endIdx: lines.length, isComplex };
};

/**
 * Exclusive end index of a block scalar's body (the lines after a
 * ``key: |-`` / ``!lambda |-`` header), one past the last content line.
 *
 * A block scalar terminates on indentation alone, unlike a mapping
 * value block: the first non-blank line less-indented than the body's
 * own content indent ends it, *even when it's a comment*. A ``#``
 * indented at or past the body's content indent is literal scalar text
 * and stays in the block; a column-0 ``# ...`` before the next
 * top-level key does not (it would otherwise be swallowed into the
 * lambda). Trailing blank lines are excluded — they belong to the
 * inter-section gap that ``updateSectionInYaml`` preserves, so the
 * round-trip neither drops nor duplicates them; interior blanks between
 * content lines are kept. The content indent is set by the first
 * non-blank line; a header with no deeper line (indent <=
 * *parentIndentLen*) has an empty body.
 */
export const _blockScalarBodyEnd = (
  lines: string[],
  startIdx: number,
  parentIndentLen: number
): number => {
  let contentIndent = -1;
  let lastContent = startIdx - 1;
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const indent = _leadingIndent(lines[i]).length;
    if (contentIndent === -1) {
      if (indent <= parentIndentLen) break;
      contentIndent = indent;
    } else if (indent < contentIndent) {
      break;
    }
    lastContent = i;
  }
  return lastContent + 1;
};
