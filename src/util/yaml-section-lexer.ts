/**
 * Lexer layer for the section editor's minimal YAML reader: the regexes
 * and line/indent classifiers the structural reader and mutation facade
 * build on. Pure — depends on nothing in this feature beyond the indent
 * constant. (Scalar value parsing lives in yaml-scalar.ts.)
 */

import { ESPHOME_YAML_INDENT } from "./esphome-yaml-lang.js";

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
export const KEY_PATTERN = "[a-zA-Z_][^\\s:#]*";

/**
 * Matches a line that begins a top-level YAML section (column-0
 * identifier). Mirrors ``KEY_PATTERN``'s leading-character set —
 * accepts ``_internal:`` and similar underscore-leading keys, not
 * just ASCII letters. Used by every "stop at the next sibling
 * section" terminator across these layers so the predicate stays
 * consistent — drift between sites would let one walk past a
 * section header another walk treats as a hard stop.
 */
export const TOP_LEVEL_KEY_START_RE = /^[a-zA-Z_]/;

/**
 * Capture a column-0 top-level key. Group 1 is the key; the prefix
 * form (no end anchor) matches whether or not the key carries an
 * inline value, so callers that only want the name can ignore the
 * rest of the line. Companion to ``TOP_LEVEL_KEY_START_RE`` — shared
 * so the several "what's the top-level key on this line" sites don't
 * each re-spell the identifier class.
 */
export const TOP_LEVEL_KEY_RE = /^([a-zA-Z_][a-zA-Z0-9_]*):/;

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
export const LIST_ITEM_INLINE_KEY_RE = new RegExp(`^\\s*-\\s+(${KEY_PATTERN}):\\s*(.*)$`);

/**
 * Detect a YAML list-item start. Accepts both the standard
 * `  - <content>` form and the bare `  -` (end-of-line) form
 * `updateSectionInYaml` emits when a list item's inline-keyed
 * value can't be represented inline (object / array / null).
 *
 * Loosened from a stricter `/^\s+-\s/` so the parser agrees with
 * what the serializer (`updateSectionInYaml` in `yaml-section-values.ts`) emits. ESPHome's
 * own YAML output never produces a bare-`-` outside that
 * round-trip path, so this is the only realistic source. The indent
 * is `\s*`, not `\s+`: a zero-indented sequence puts dashes at
 * column 0.
 */
export const LIST_ITEM_START_RE = /^\s*-(\s|$)/;

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
 *
 * An optional YAML tag (`!lambda`, `!secret`) may sit between the
 * colon and the `|`/`>` marker (`multiply: !lambda |-`); ESPHome's
 * templatable fields emit that shape, so the tag has to count as a
 * block-scalar header too.
 */
export const BLOCK_SCALAR_RE = /^[^"']*:\s*(?:!\S+\s+)?[|>][-+]?\s*(?:#.*)?$/;

/**
 * Match the part AFTER the colon on a `key: |-` line (the `raw` value
 * the parser captures) as a block-scalar header: an optional YAML tag,
 * the `|`/`>` marker, and an optional trailing comment. Capture group 1
 * is the tag (or undefined), group 2 the marker.
 *
 * The trailing `\s*(?:#.*)?` mirrors `BLOCK_SCALAR_RE` so a header
 * comment (`!lambda |- # note`) still reads as a block scalar rather
 * than falling through to inline-scalar parsing. An undefined tag is
 * the plain `|-`/`>` case; a `!lambda` tag is what the reader turns
 * into an editable lambda instead of the literal string `"!lambda |-"`.
 */
const BLOCK_SCALAR_INLINE_RE = /^(?:(!\S+)\s+)?([|>][-+]?)\s*(?:#.*)?$/;

/** A parsed block-scalar header: its optional tag and its `|`/`>` marker. */
export interface BlockScalarHeader {
  tag: string | undefined;
  marker: string;
}

export const parseBlockScalarHeader = (raw: string): BlockScalarHeader | null => {
  const m = raw.match(BLOCK_SCALAR_INLINE_RE);
  return m ? { tag: m[1], marker: m[2] } : null;
};

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
 * as ``{}`` placeholders. Indent is ``\s*`` for
 * ``LIST_ITEM_START_RE``'s column-0 reason.
 */
export const LIST_ITEM_BARE_DASH_RE = /^\s*-\s*$/;

/**
 * Capture the ``<indent>-<spaces>`` prefix up to the first non-space of a
 * list item's inline key (``  - file:`` → ``"  - "``). Its length is the
 * column the item's child keys align to, which `_detectSectionChildIndent`
 * uses so a first field that is itself a nested mapping doesn't pull the
 * child column down to its grandchildren. No match for a bare dash.
 */
export const LIST_ITEM_INLINE_KEY_PREFIX_RE = /^(\s*-\s*)\S/;

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
 * complex. Indent is ``\s*`` for ``LIST_ITEM_START_RE``'s
 * column-0 reason.
 */
export const LIST_ITEM_DICT_KEY_RE = /^\s*-\s+[a-zA-Z_][\w.]*:(?:\s|$)/;

export const childRegexFor = (indent: string) =>
  // Group 2 captures the post-colon separator: ``key:#fragment`` (no
  // whitespace) keeps the ``#`` as value text (#1388), matching the
  // dash-line leniency, while ``key: # note`` stays a comment-only empty
  // value (#1385).
  new RegExp(`^${indent}(${KEY_PATTERN}):(\\s*)(.*)$`);

// Intentionally permissive — the body after `- ` can be any
// scalar (string with spaces, number, !secret reference) and we
// just round-trip it. Validating the leading-token shape here
// would over-match `KEY_PATTERN`'s purpose; that constraint
// applies only to dict keys. The argument is the indent BEFORE
// the dash (detected from the actual list content by the caller),
// not the parent key's indent — a 4-space user file puts the
// dash at ``parent + 4``, not the canonical ``parent + 2``.
export const listItemRegexFor = (dashIndent: string) =>
  new RegExp(`^${dashIndent}-\\s+(.*)$`);

/**
 * True when *line* is structurally invisible to the key/value
 * parser — blank, or a comment-only line whose first non-whitespace
 * character is ``#``. Centralised so every "skip blank line"
 * loop across these layers also skips comments; otherwise a comment
 * between ``key:`` and a child list/mapping (or interleaved with
 * list items) makes the parser bail or terminate early, dropping
 * the field from values and deleting it on the next save.
 *
 * This minimal parser doesn't preserve comments on round-trip
 * either way — they're already silently dropped by the
 * line-by-line serializer. Skipping them here just keeps comments
 * from corrupting the structural read.
 */
export const isCommentLine = (line: string): boolean => line.trim().startsWith("#");

export const isBlankOrCommentLine = (line: string): boolean =>
  line.trim() === "" || isCommentLine(line);

/**
 * Walk forward from *startIdx* skipping blank and comment-only
 * lines. Returns the first index that holds real content, or
 * ``lines.length`` if none.
 */
export const _skipBlankAndCommentLines = (lines: string[], startIdx: number): number => {
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
export const _leadingIndent = (line: string): string => line.match(/^ */)![0];

/**
 * Walk forward from *startIdx* and return the indent of the first
 * line that's a child of the section that starts at *startIdx*.
 * "Child" means deeper-indented than the section's leading
 * whitespace and not a sibling section header (a column-0
 * identifier line). Returns the canonical 2-space indent when
 * the section has no readable children — the empty case where
 * the parser has nothing to learn from.
 */
export const _detectSectionChildIndent = (
  lines: string[],
  startIdx: number,
  isListItem: boolean
): string => {
  // The "floor" is the column a child line must strictly beat. For
  // map sections that's the section header's leading whitespace;
  // for list-item sections it's one column past the dash, so a
  // child key (at ``dash + 2``) clears it while a sibling dash
  // (same column as ours) doesn't.
  const headLine = lines[startIdx];
  // An inline key on the dash line (``- key:``) fixes the item's child
  // column at that key — even when the key's own value is a deeper nested
  // block (``- file:\n      type: …``). Scanning the next line would then
  // read the grandchild's indent and mis-level the item's sibling keys,
  // dropping them and the nested value (#1389 follow-up). The bare-dash
  // case (value on the next line) still falls through to the scan below.
  if (isListItem) {
    // The inline key's column is where the item's child keys align — even
    // when that first field is itself a nested mapping (#1389 follow-up).
    const inlineKey = headLine.match(LIST_ITEM_INLINE_KEY_PREFIX_RE);
    if (inlineKey) return " ".repeat(inlineKey[1].length);
  }
  const floor = isListItem ? headLine.indexOf("-") + 1 : _leadingIndent(headLine).length;
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
export const _detectListItemChildIndent = (
  lines: string[],
  startIdx: number,
  dashIndent: string
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
export const isListItemLine = (line: string, dashIndent: string): boolean => {
  const prefix = `${dashIndent}-`;
  if (!line.startsWith(prefix)) return false;
  const trailing = line.slice(prefix.length);
  return trailing === "" || trailing.startsWith(" ");
};

/**
 * True when *line* is a list-item dash that belongs to *parentIndent*'s
 * child list. Accepts both deeper-indent dashes (the standard YAML
 * shape) and same-indent dashes (YAML 1.2's compact block-sequence
 * form: ``calibration:\n- a\n- b`` parses to ``{calibration: [a, b]}``).
 * The exact dash column doesn't matter at peek time — ``parseListBlock``
 * picks it up from the actual line — so the peek only needs to
 * confirm "this is a child list of the current key, regardless of
 * which indent step the user picked". 4-space YAML pastes and ESPHome
 * example snippets both work as a result.
 */
export const isChildListItemLine = (line: string, parentIndent: string): boolean => {
  const lead = _leadingIndent(line);
  if (lead.length < parentIndent.length) return false;
  const tail = line.slice(lead.length);
  return tail === "-" || tail.startsWith("- ");
};

/**
 * The one rule for "where does a block end". True when *line* terminates a
 * block whose opener key sits at *openerIndent* columns. Blank and
 * comment-only lines never terminate (they belong to the block); a line
 * indented deeper is the block's body; a *same-indent* compact
 * block-sequence dash (``calibration:\n- a\n- b``, bare ``-`` or ``- x``)
 * continues the block; any other same-indent or shallower line ends it.
 *
 * Every block-boundary scan funnels through here so the same-indent-
 * sequence and comment cases are handled in one place instead of being
 * relearned (and mis-learned) per call site.
 */
export const endsBlockAtIndent = (line: string, openerIndent: number): boolean => {
  if (isBlankOrCommentLine(line)) return false;
  const lineIndent = _leadingIndent(line).length;
  if (lineIndent < openerIndent) return true;
  if (lineIndent > openerIndent) return false;
  return !isChildListItemLine(line, line.slice(0, lineIndent));
};
