/**
 * Parse and rewrite key: value pairs in a section of a YAML document.
 *
 * Supports scalars (quoted/unquoted, booleans), block lists of scalars,
 * flow lists (`[a, b, c]`), and recursively-nested objects. Designed for
 * the section editor — round-trips the values that ConfigEntry forms
 * read and write — not as a general YAML parser.
 */

import { ESPHOME_YAML_INDENT } from "./esphome-yaml-lang.js";
import {
  YamlRawValue,
  formatYamlScalar,
  parseYamlBoolean,
  serializeYamlValues,
  type SerializeYamlOptions,
} from "./yaml-serialize.js";

/**
 * Identifier alphabet for plain-scalar YAML keys the parser will
 * accept. The leading character stays strict (``[a-zA-Z_]``) so
 * list-item dashes, comment lines, and YAML anchors / aliases
 * (``&foo``, ``*foo``) can't masquerade as keys. The body is
 * permissive — anything that isn't whitespace, ``:`` (separator),
 * or ``#`` (comment) — so URL- and path-derived names that
 * user-keyed sections like ``packages:`` and ``substitutions:``
 * accept (``ApolloAutomation.R-PRO-1-ETH``, ``vendor/lib@v1``,
 * ``com.example.thing``) round-trip through the form editor
 * without dropping the row.
 *
 * Quoted keys (``"foo:bar":`` etc.) and other exotic forms aren't
 * matched here; lines using them are skipped by the minimal parser
 * and therefore won't appear in the returned values map or today's
 * MAP editor. Supporting them would require a different parsing
 * strategy; see issue tracker for upstream support if needed.
 */
const KEY_PATTERN = "[a-zA-Z_][^\\s:#]*";

/**
 * Matches a line that begins a top-level YAML section (column-0
 * identifier). Mirrors ``KEY_PATTERN``'s leading-character set —
 * accepts ``_internal:`` and similar underscore-leading keys, not
 * just ASCII letters. Used by every "stop at the next sibling
 * section" terminator in this module so the predicate stays
 * consistent — drift between sites would let one walk past a
 * section header another walk treats as a hard stop.
 */
const TOP_LEVEL_KEY_START_RE = /^[a-zA-Z_]/;

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
 * Match a bare-dash list item (``    -`` followed by EOL or only
 * whitespace). The serializer emits this shape as a placeholder
 * for an empty mapping item — a freshly-added Add row the user
 * saved before filling fields. Without flagging it as a
 * complexity signal the scalar-list branch in ``parseListBlock``
 * runs (``- `` regex misses the bare dash, items=0), the key is
 * dropped from the values dict, and the user's empty row vanishes
 * on save. Marking it complex routes the block through
 * ``collectBlockListMappings`` which already treats bare dashes
 * as ``{}`` placeholders.
 */
const LIST_ITEM_BARE_DASH_RE = /^\s+-\s*$/;

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
// applies only to dict keys. The argument is the indent BEFORE
// the dash (detected from the actual list content by the caller),
// not the parent key's indent — a 4-space user file puts the
// dash at ``parent + 4``, not the canonical ``parent + 2``.
const listItemRegexFor = (dashIndent: string) =>
  new RegExp(`^${dashIndent}-\\s+(.*)$`);

/**
 * True when *line* is structurally invisible to the key/value
 * parser — blank, or a comment-only line whose first non-whitespace
 * character is ``#``. Centralised so every "skip blank line"
 * loop in this module also skips comments; otherwise a comment
 * between ``key:`` and a child list/mapping (or interleaved with
 * list items) makes the parser bail or terminate early, dropping
 * the field from values and deleting it on the next save.
 *
 * This minimal parser doesn't preserve comments on round-trip
 * either way — they're already silently dropped by the
 * line-by-line serializer. Skipping them here just keeps comments
 * from corrupting the structural read.
 */
const isBlankOrCommentLine = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
};

/**
 * Walk forward from *startIdx* skipping blank and comment-only
 * lines. Returns the first index that holds real content, or
 * ``lines.length`` if none.
 */
const _skipBlankAndCommentLines = (
  lines: string[],
  startIdx: number,
): number => {
  let j = startIdx;
  while (j < lines.length && isBlankOrCommentLine(lines[j])) j++;
  return j;
};

/**
 * Measure the leading whitespace on *line* — used to detect the
 * actual indent the user's YAML uses for the first child of a
 * section. The parser is tied to ESPHome's emit format (2 spaces
 * per level) at write time, but reads must accept any consistent
 * indent: a user-typed 4-space file is just as valid as the
 * 2-space canonical form, and pasting one into the editor
 * shouldn't silently come back empty.
 */
const _leadingIndent = (line: string): string =>
  line.match(/^ */)![0];

/**
 * Walk forward from *startIdx* and return the indent of the first
 * line that's a child of the section that starts at *startIdx*.
 * "Child" means deeper-indented than the section's leading
 * whitespace and not a sibling section header (a column-0
 * identifier line). Returns the canonical 2-space indent when
 * the section has no readable children — the empty case where
 * the parser has nothing to learn from.
 */
const _detectSectionChildIndent = (
  lines: string[],
  startIdx: number,
  isListItem: boolean,
): string => {
  // The "floor" is the column a child line must strictly beat. For
  // map sections that's the section header's leading whitespace;
  // for list-item sections it's one column past the dash, so a
  // child key (at ``dash + 2``) clears it while a sibling dash
  // (same column as ours) doesn't.
  const headLine = lines[startIdx];
  const floor = isListItem
    ? headLine.indexOf("-") + 1
    : _leadingIndent(headLine).length;
  const fallback = isListItem
    ? `${ESPHOME_YAML_INDENT}${ESPHOME_YAML_INDENT}`
    : ESPHOME_YAML_INDENT;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isBlankOrCommentLine(line)) continue;
    // Column-0 identifier ⇒ sibling section, this section has no
    // children of its own.
    if (TOP_LEVEL_KEY_START_RE.test(line)) return fallback;
    const lead = _leadingIndent(line);
    if (lead.length > floor) return lead;
    // Sibling dash (list-item) or back-out (map) — done scanning.
    return fallback;
  }
  return fallback;
};

/**
 * Find the indent of the first sub-key inside a list item — the
 * line just under ``${dashIndent}- key: …`` that starts at a
 * deeper column. Returns ``null`` when the item has no
 * follow-up sub-keys before the next sibling dash (a single-key
 * item or a freshly-added bare-dash placeholder); the caller
 * falls back to a canonical 2-space step in that case.
 */
const _detectListItemChildIndent = (
  lines: string[],
  startIdx: number,
  dashIndent: string,
): string | null => {
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (isBlankOrCommentLine(line)) continue;
    const lead = _leadingIndent(line);
    // A sibling dash (or shallower) terminates this item.
    if (lead.length <= dashIndent.length) return null;
    // Skip nested list items (``      - ``) under this item —
    // those are not the item's own child keys.
    if (line[lead.length] === "-") continue;
    return lead;
  }
  return null;
};

/**
 * True when *line* is a list-item dash at *dashIndent*. Accepts
 * both ``${dashIndent}- ``  (item with content) and the bare
 * ``${dashIndent}-`` followed by EOL (the placeholder shape the
 * serializer emits for an empty mapping item — a freshly-added
 * Add-button row the user hasn't filled in yet). Without the
 * bare-dash branch the parser would skip the empty row on
 * reload and the user's freshly-added item would silently
 * vanish.
 */
const isListItemLine = (line: string, dashIndent: string): boolean => {
  const prefix = `${dashIndent}-`;
  if (!line.startsWith(prefix)) return false;
  const trailing = line.slice(prefix.length);
  return trailing === "" || trailing.startsWith(" ");
};

/**
 * True when *line* is a list-item dash deeper than *parentIndent*.
 * The exact dash column doesn't matter at peek time — that's
 * detected later by ``parseListBlock`` from the actual line —
 * so the peek check only needs to confirm "this is a child
 * list of the current key, regardless of which indent step the
 * user picked". 4-space YAML pastes work as a result.
 */
const isDeeperListItemLine = (
  line: string,
  parentIndent: string,
): boolean => {
  const lead = _leadingIndent(line);
  if (lead.length <= parentIndent.length) return false;
  const tail = line.slice(lead.length);
  return tail === "-" || tail.startsWith("- ");
};

const stripQuotes = (s: string): string => {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
};

// Quoting in YAML is the explicit "treat me as a string" signal —
// ``key: "on"`` must stay the literal ``"on"`` even though ``on`` is
// a truthy spelling. Detect the quotes BEFORE stripping so we only
// run the boolean coercion on plain scalars; otherwise a string
// field that happens to hold ``"on"`` / ``"yes"`` would silently
// flip to boolean ``true`` on round-trip.
const parseScalar = (raw: string): unknown => {
  const wasQuoted =
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"));
  const v = stripQuotes(raw);
  if (!wasQuoted) {
    const bool = parseYamlBoolean(v);
    if (bool !== null) return bool;
  }
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
    if (isBlankOrCommentLine(lines[j])) continue;
    if (!lines[j].startsWith(prefix)) break;
    const m = lines[j].match(itemRegex);
    if (!m) break;
    items.push(stripQuotes(m[1].trim()));
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
const _detectFirstDashIndent = (
  lines: string[],
  startIdx: number,
  fallback: string,
): { dashIndent: string; firstDashIdx: number } => {
  let firstDashIdx = startIdx;
  while (
    firstDashIdx < lines.length &&
    isBlankOrCommentLine(lines[firstDashIdx])
  ) {
    firstDashIdx++;
  }
  if (firstDashIdx >= lines.length) {
    return { dashIndent: fallback, firstDashIdx };
  }
  const dashIndent =
    lines[firstDashIdx].match(/^( *)-/)?.[1] ?? fallback;
  return { dashIndent, firstDashIdx };
};

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
  parentIndent: string,
): {
  value: YamlRawValue | Record<string, unknown>[] | string[];
  endIdx: number;
  isEmptyScalarList: boolean;
} => {
  const canonicalDashIndent = `${parentIndent}${ESPHOME_YAML_INDENT}`;
  const { dashIndent, firstDashIdx } = _detectFirstDashIndent(
    lines,
    startIdx,
    canonicalDashIndent,
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
    const mapping = collectBlockListMappings(
      lines,
      startIdx,
      dashIndent,
      childIndent,
    );
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
    listItemRegexFor(dashIndent),
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
  raw: string,
): { key: string; value: unknown } | null => {
  // Dotted keys (``logger.log:``, ``switch.turn_on:``) are
  // automation-action shorthand — not flat-mapping fields. Bail
  // so the surrounding parser keeps the block as YamlRawValue
  // and the serializer doesn't quote the dotted key on save.
  if (key.includes(".")) return null;
  if (raw === "" || BLOCK_SCALAR_INLINE_RE.test(raw)) return null;
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
  re: RegExp,
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
  item: Record<string, unknown>,
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
  childIndent: string,
): { items: Record<string, unknown>[]; endIdx: number } | null => {
  const headerRe = new RegExp(
    `^${dashIndent}-\\s+(${KEY_PATTERN}):\\s*(.*)$`,
  );
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
    at: number,
  ): { item: Record<string, unknown>; endIdx: number } | null => {
    // Same null-prototype defence as the surrounding parser — see
    // the comment in ``parseYamlSectionValues``.
    const item: Record<string, unknown> = Object.create(null);
    if (!LIST_ITEM_BARE_DASH_RE.test(lines[at])) {
      const header = _matchFlatMappingField(lines[at], headerRe);
      if (!header) return null;
      item[header.key] = header.value;
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
  keyIndent: string,
): { endIdx: number; isComplex: boolean } => {
  let isComplex = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (isBlankOrCommentLine(line)) continue;
    const lead = line.match(/^ */)![0];
    if (lead.length <= keyIndent.length) return { endIdx: i, isComplex };
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
  // Detect the indent the user actually picked for this
  // section's children so 4-space (or other consistent) YAMLs
  // round-trip through the editor without coming back empty.
  // Falls back to ESPHome's canonical 2-space step on empty
  // sections.
  const childIndent = _detectSectionChildIndent(lines, startIdx, isListItem);
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

      if (isDeeperListItemLine(peekLine, childIndent)) {
        const { value, endIdx, isEmptyScalarList } = parseListBlock(
          lines,
          i + 1,
          childIndent,
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
  indent: string,
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
      if (
        peek < lines.length &&
        isDeeperListItemLine(lines[peek], indent)
      ) {
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
      if (TOP_LEVEL_KEY_START_RE.test(lines[i])) {
        end = i;
        break;
      }
    } else if (TOP_LEVEL_KEY_START_RE.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/**
 * Replace the body of a section in a YAML document with `values`.
 *
 * ``options.keepEmptyStrings`` opts the serializer out of dropping
 * empty-string values. Required for top-level user-keyed sections
 * (``substitutions:``) where every key the user typed is
 * intentional data and ``""`` is a valid value the YAML must
 * round-trip; left at the default ``false`` for ordinary
 * config-entries where ``""`` means "user cleared the field".
 */
export function updateSectionInYaml(
  yaml: string,
  sectionKey: string,
  values: Record<string, unknown>,
  fromLine?: number,
  options: SerializeYamlOptions = {},
): string {
  const lines = yaml.split("\n");
  const { start, end } = findSectionRange(lines, sectionKey, fromLine);
  if (start < 0) return yaml;

  const isListItem = LIST_ITEM_START_RE.test(lines[start]);
  // Match the user's existing indent step on save so 4-space (or
  // other consistent) YAML doesn't get re-emitted with a mixed
  // 2-space slice. Falls back to the canonical 2-space step when
  // the section is otherwise empty.
  const childIndent = _detectSectionChildIndent(lines, start, isListItem);
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
  // For non-list-item sections the user's indent step IS the
  // section's child indent (top-level keys at column 0, children
  // at one step deeper). Pass that through so nested-mapping
  // recursion preserves the user's chosen step end-to-end.
  //
  // For list-item sections the picture is messier — child keys
  // align with the inline first key after the dash, not at a
  // step-multiple — and there's no clean "user step" to read off.
  // Default to canonical 2-space; the round-trip stays
  // valid-and-readable even when the surrounding file uses a
  // different step elsewhere.
  const detectedStep =
    !isListItem && childIndent ? childIndent : ESPHOME_YAML_INDENT;
  const newLines = [
    dashLine,
    ...serializeYamlValues(toSerialize, childIndent, {
      ...options,
      indentStep: options.indentStep ?? detectedStep,
    }),
  ];
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
    while (parentIdx >= 0 && !TOP_LEVEL_KEY_START_RE.test(lines[parentIdx])) {
      parentIdx--;
    }
    if (parentIdx >= 0) {
      let hasContent = false;
      let parentEnd = lines.length;
      for (let i = parentIdx + 1; i < lines.length; i++) {
        if (TOP_LEVEL_KEY_START_RE.test(lines[i])) {
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
