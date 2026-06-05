/**
 * Structural reader for YAML sections: dispatches list/mapping/nested
 * blocks into a plain values object (``parseYamlSectionValues``). Sits
 * on the lexer primitives; the mutation facade sits on this.
 */

import { ESPHOME_YAML_INDENT } from "./esphome-yaml-lang.js";
import { LIST_SECTIONS } from "./section-entry-overrides.js";
import {
  _detectFirstDashIndent,
  _detectListItemChildIndent,
  _detectSectionChildIndent,
  _leadingIndent,
  _skipBlankAndCommentLines,
  BLOCK_SCALAR_INLINE_RE,
  BLOCK_SCALAR_RE,
  childRegexFor,
  collectBlockListItems,
  isBlankOrCommentLine,
  isChildListItemLine,
  isListItemLine,
  KEY_PATTERN,
  LIST_ITEM_BARE_DASH_RE,
  LIST_ITEM_DICT_KEY_RE,
  LIST_ITEM_INLINE_KEY_RE,
  LIST_ITEM_START_RE,
  listItemRegexFor,
  parseFlowList,
  parseScalar,
  TOP_LEVEL_KEY_START_RE,
} from "./yaml-section-lexer.js";
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
 * Parse a single ``key: value`` field of a flat-mapping list item
 * — used by ``collectBlockListMappings`` for both the inline header
 * (``- key: value``) and the follow-up child lines. Returns
 * ``null`` whenever the field carries anything outside the
 * mapping-list contract (dotted automation-trigger keys, empty
 * raw values that would open a nested mapping/list, block-scalar
 * headers). Callers translate ``null`` into "bail out, fall back
 * to YamlRawValue".
 */
const parseFlatMappingField = (
  key: string,
  raw: string
): { key: string; value: unknown } | null => {
  // Dotted keys (``logger.log:``, ``switch.turn_on:``) are
  // automation-action shorthand — not flat-mapping fields. Bail
  // so the surrounding parser keeps the block as YamlRawValue
  // and the serializer doesn't quote the dotted key on save.
  if (key.includes(".")) return null;
  // Block-scalar headers (``key: |-``) stay opaque so the body
  // round-trips through YamlRawValue; ``parseScalar("|-")`` would
  // otherwise return the literal string ``"|-"``.
  if (BLOCK_SCALAR_INLINE_RE.test(raw)) return null;
  // ``key:`` with no value is structurally ``{key: null}`` in YAML.
  // Recognising it here is what lets list-of-single-key-mappings
  // (light ``effects:``, sensor ``filters:``, any registry-shaped
  // field) round-trip through the section editor instead of
  // falling back to YamlRawValue. #941.
  if (raw === "") return { key, value: null };
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
const _matchFlatMappingField = (
  line: string,
  re: RegExp
): { key: string; value: unknown } | null => {
  const m = line.match(re);
  return m ? parseFlatMappingField(m[1], m[2].trim()) : null;
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
      const header = _matchFlatMappingField(lines[at], headerRe);
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
  keyIndent: string
): { endIdx: number; isComplex: boolean } => {
  let isComplex = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (isBlankOrCommentLine(line)) continue;
    const lead = line.match(/^ */)![0];
    if (lead.length < keyIndent.length) return { endIdx: i, isComplex };
    if (lead.length === keyIndent.length) {
      // YAML's compact block-sequence form allows a child list to
      // share the parent key's indent (``calibration:\n- a\n- b``).
      // Same-indent dash lines stay in the block; any other shape
      // at this indent terminates as before.
      const tail = line.slice(lead.length);
      if (tail !== "-" && !tail.startsWith("- ")) return { endIdx: i, isComplex };
    }
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
 * List-item recognition uses the loose `LIST_ITEM_START_RE` so
 * the parser agrees with what `updateSectionInYaml` in this same
 * module can emit (including the bare `  -` dash that the
 * non-scalar inline-value path produces). The parser must agree
 * with the serializer; if you tighten one, tighten both.
 */
export function parseYamlSectionValues(
  yaml: string,
  sectionKey: string,
  fromLine?: number
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
      return values;
    }
  }

  // List-item form: the first child key may sit on the same line as
  // the leading dash (e.g. `  - platform: gpio\n    pin: 4`).
  if (isListItem) {
    const firstMatch = lines[startIdx].match(LIST_ITEM_INLINE_KEY_RE);
    if (firstMatch) {
      const raw = firstMatch[2].trim();
      if (raw !== "") values[firstMatch[1]] = parseScalar(raw);
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
