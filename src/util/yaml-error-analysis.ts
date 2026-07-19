/**
 * Pure analysis of ESPHome / PyYAML error messages against a YAML buffer.
 *
 * Everything here is DOM- and CodeMirror-free so both consumers share one
 * implementation: the editor's backend linter (`yaml-lint-backend.ts`,
 * squiggles + invalid banner + hover auto-fix) and the save-time validation
 * prompt (`yaml-validation-summary.ts`). The load-bearing subtleties — the
 * problem mark is the LAST `line N, column M` in a PyYAML message, absolute
 * paths get collapsed to basenames, indentation mismatches resolve to a
 * signed one-line repair — live only here.
 */
import type { LocalizeFunc } from "../common/localize.js";
import { indentOf, parseListItemMarker, stripComment } from "./yaml-line-walker.js";

/** Match `line N, column M` (1-indexed) globally in a YAML parse error message. */
const YAML_LINE_COL_RE = /line\s+(\d+)\s*,\s*column\s+(\d+)/gi;
/** Fallback: bare `line N` if the column is missing from the message. */
const YAML_LINE_RE = /line\s+(\d+)/gi;

/** A quoted path (POSIX `/` or Windows `\`) — keep the basename, drop the dir. */
const QUOTED_PATH_RE = /"([^"]*[/\\])([^"/\\]+)"/g;

/** `key:` pair line (no marker), capturing (key, value?). Whitespace or EOL
 *  must follow the ':' — `key:value` is a plain scalar, not a pair. Broader
 *  than the walker's RE_PAIR_LINE — any non-`:` key token, so quoted or
 *  dotted keys still match. */
const PAIR_RE = /^\s*([^\s:#][^:]*?)\s*:(?:\s+(.*))?$/;

/** Analysis walks never scan further than this many lines. */
const WALK_BOUND = 50;

/** Canonical child-indent step. A literal two: this module stays free of
 *  esphome-yaml-lang's CodeMirror import graph, where ESPHOME_YAML_INDENT
 *  is the same two spaces. */
const YAML_INDENT_STEP = 2;

/**
 * Strip absolute directory paths out of a backend error message.
 *
 * ESPHome / PyYAML errors embed the config's absolute path
 * (`"/Users/me/esphome/foo.yaml"` or `"C:\\Users\\me\\foo.yaml"`),
 * leaking the host filesystem layout and username into the UI. Collapse
 * any quoted path to its basename.
 */
export function sanitizeMessage(message: string): string {
  return message.replace(QUOTED_PATH_RE, '"$2"');
}

/**
 * Pull the real error location out of a PyYAML parse message.
 *
 * PyYAML reports the context mark (where the enclosing block started,
 * often line 1) first and the problem mark (where the bad token was
 * found) last, so the LAST `line N, column M` is the actual location.
 * Falls back to a bare `line N`; `null` when the message carries no
 * position at all.
 */
export function parseYamlErrorPosition(
  message: string
): { line: number; col: number | null } | null {
  const colMatches = [...message.matchAll(YAML_LINE_COL_RE)];
  if (colMatches.length) {
    const last = colMatches[colMatches.length - 1];
    return { line: Number.parseInt(last[1], 10), col: Number.parseInt(last[2], 10) };
  }
  const lineMatches = [...message.matchAll(YAML_LINE_RE)];
  if (lineMatches.length) {
    return {
      line: Number.parseInt(lineMatches[lineMatches.length - 1][1], 10),
      col: null,
    };
  }
  return null;
}

/**
 * The FIRST position in a PyYAML message — the context mark, where the
 * construct the scanner choked on begins (e.g. the simple key it was
 * scanning), as opposed to where scanning gave up.
 */
export function parseYamlErrorContext(
  message: string
): { line: number; col: number | null } | null {
  const colMatch = [...message.matchAll(YAML_LINE_COL_RE)][0];
  if (colMatch) {
    return {
      line: Number.parseInt(colMatch[1], 10),
      col: Number.parseInt(colMatch[2], 10),
    };
  }
  const lineMatch = [...message.matchAll(YAML_LINE_RE)][0];
  return lineMatch ? { line: Number.parseInt(lineMatch[1], 10), col: null } : null;
}

/** A line accessor over the current document; `undefined` past the ends. */
export type ReadLine = (line1: number) => string | undefined;

/** Blank or comment-only — every walk skips these. */
function isBlankOrComment(text: string): boolean {
  return !text.trim() || text.trimStart().startsWith("#");
}

/** Nearest content line from *line* in *step* direction, bounded. */
function adjacentContentLine(
  readLine: ReadLine,
  line: number,
  step: 1 | -1
): { line: number; text: string } | null {
  for (let i = 1; i <= WALK_BOUND; i++) {
    const n = line + step * i;
    if (n < 1) return null;
    const text = readLine(n);
    if (text === undefined) return null;
    if (isBlankOrComment(text)) continue;
    return { line: n, text };
  }
  return null;
}

/** Nearest non-blank, non-comment line above *line*. */
function contentLineAbove(readLine: ReadLine, line: number) {
  return adjacentContentLine(readLine, line, -1);
}

/** Nearest non-blank, non-comment line below *line*. */
function contentLineBelow(readLine: ReadLine, line: number) {
  return adjacentContentLine(readLine, line, 1);
}

/**
 * Indent of a list item's first property line minus *contentCol* (where its
 * key starts), or `null` when the item has no property line — the next
 * content is a shallower sibling/dedent (indent below *contentCol*), not a
 * property, so it never reports a spurious negative delta.
 */
export function firstPropertyDelta(
  readLine: ReadLine,
  line: number,
  contentCol: number
): number | null {
  const next = contentLineBelow(readLine, line);
  if (next === null) return null;
  const indent = indentOf(next.text);
  return indent < contentCol ? null : indent - contentCol;
}

/** Don't guess a sibling alignment beyond this many spaces — a large
 *  mismatch is structural confusion, where the generic hint beats a
 *  confidently wrong auto-fix. */
const MAX_SIBLING_ALIGN = 3;

/**
 * Signed delta re-aligning a blamed `- ` marker with the sibling marker
 * above it, skipping the previous item's deeper property lines. Null when
 * no sibling marker is found before the walk leaves the list (a line at or
 * below the blamed indent), when the sibling already lines up, or when the
 * mismatch exceeds MAX_SIBLING_ALIGN.
 */
function siblingMarkerDelta(
  readLine: ReadLine,
  line: number,
  markerIndent: number
): number | null {
  for (let n = line - 1; n >= 1 && n >= line - WALK_BOUND; n--) {
    const text = readLine(n);
    if (text === undefined) return null;
    if (isBlankOrComment(text)) continue;
    const indent = indentOf(text);
    if (parseListItemMarker(text)) {
      const delta = indent - markerIndent;
      return delta !== 0 && Math.abs(delta) <= MAX_SIBLING_ALIGN ? delta : null;
    }
    if (indent <= markerIndent) return null;
  }
  return null;
}

/** First key token of a line — a list item's key, a plain `key:`, or null. */
export function lineKeyToken(text: string): string | null {
  const marker = parseListItemMarker(text);
  if (marker) return marker.key;
  const hit = text.match(PAIR_RE);
  return hit ? hit[1] : null;
}

/** Whether the line is a `key: value` pair with a non-empty value. */
function lineHasValue(text: string): boolean {
  return Boolean(stripComment(text).match(PAIR_RE)?.[2]);
}

/** The line's key when it is a value-less `key:` opener, else null.
 *  Callers pre-filter `- ` marker lines. */
function valuelessKeyOf(text: string): string | null {
  return lineHasValue(text) ? null : lineKeyToken(text);
}

/** The raw key of a `-key:` pair (a list dash stuck to its key), else null. */
function botchedDashKey(text: string): string | null {
  if (parseListItemMarker(text)) return null;
  const key = text.match(PAIR_RE)?.[1];
  return key !== undefined && key.length > 1 && key[0] === "-" && key[1] !== "-"
    ? key
    : null;
}

/** A `- ` list marker typed without its space (`-platform:`), which the
 *  scanner reads as a `-platform` mapping key. */
interface MissingDashSpace {
  line: number;
  /** The stuck-dash key exactly as `lineKeyToken` reads it (`-platform`),
   *  so the apply-site staleness check compares the same token. */
  key: string;
  fromIndent: number;
}

/**
 * Find the botched `- ` marker behind an indent-family error: the blamed
 * line itself (a `-key:` mixed into a real list) or the line above it
 * (whose deeper "properties" the scanner chokes on). Null when neither
 * is a dash stuck to its key.
 */
function missingDashSpace(
  readLine: ReadLine,
  blamedLine: number
): MissingDashSpace | null {
  const ownText = readLine(blamedLine);
  if (ownText !== undefined) {
    const own = botchedDashKey(ownText);
    if (own !== null) {
      return { line: blamedLine, key: own, fromIndent: indentOf(ownText) };
    }
  }
  const prev = contentLineAbove(readLine, blamedLine);
  if (prev === null) return null;
  const above = botchedDashKey(prev.text);
  return above !== null
    ? { line: prev.line, key: above, fromIndent: indentOf(prev.text) }
    : null;
}

/**
 * A pinpointed indentation repair for the line the scanner blamed (or, for
 * `reason: "props-below"`, the marker above it). `delta` is signed: positive
 * inserts spaces, negative removes them. `reason` picks the message:
 * "props-below" is the marker-vs-its-properties mismatch; "align" re-indents
 * the blamed line to match the sibling structure around it.
 */
export interface IndentMismatch {
  markerLine: number;
  markerKey: string;
  delta: number;
  reason: "props-below" | "align";
}

/**
 * Continuation-scalar repair: the blamed line sits deeper than the valued
 * `key: value` directly above it (*prev*), so the scanner reads it as that
 * value's plain-scalar continuation and chokes on the ':'. Re-indent the
 * pair back under the value-less `key:` it fell out of, or dedent the
 * blamed line when there is no such block. Null when the mismatch is too
 * large to call.
 */
function continuationScalarFix(
  readLine: ReadLine,
  errorLine: number,
  errText: string,
  propIndent: number,
  prev: { line: number; text: string }
): IndentMismatch | null {
  const prevIndent = indentOf(prev.text);
  const prevKey = lineKeyToken(prev.text);
  const delta = propIndent - prevIndent;
  if (prevKey === null || delta > MAX_SIBLING_ALIGN) return null;
  const parent = contentLineAbove(readLine, prev.line);
  if (
    parent &&
    !parseListItemMarker(parent.text) &&
    indentOf(parent.text) === prevIndent &&
    valuelessKeyOf(parent.text) !== null
  ) {
    return { markerLine: prev.line, markerKey: prevKey, delta, reason: "align" };
  }
  const blamedKey = lineKeyToken(errText);
  return blamedKey
    ? { markerLine: errorLine, markerKey: blamedKey, delta: -delta, reason: "align" }
    : null;
}

/**
 * Repairs for a blamed line that closes a value-less opener's too-deep
 * block: re-indent the opener when a sibling above it sits at the blamed
 * line's indent (the opener was dedented — `mode:` dropped out of `pin:`,
 * blamed on `number:`), else dedent the block's first child when the blamed
 * line already sits at the opener's canonical child indent (the child went
 * too deep). Null when neither reading holds.
 */
function misplacedOpenerFix(
  readLine: ReadLine,
  errorLine: number,
  propIndent: number
): IndentMismatch | null {
  // The opener candidate: the nearest line above the blamed one that sits
  // shallower, provided it is a value-less `key:` still inside the same
  // marker-less stretch.
  let opener: { line: number; indent: number; key: string } | null = null;
  for (let n = errorLine - 1; n >= 1 && n >= errorLine - WALK_BOUND; n--) {
    const text = readLine(n);
    if (text === undefined || isBlankOrComment(text)) continue;
    if (parseListItemMarker(text)) break;
    const indent = indentOf(text);
    if (opener === null) {
      if (indent >= propIndent) continue;
      const key = valuelessKeyOf(text);
      if (key === null) break;
      opener = { line: n, indent, key };
      // A top-level opener can't have been dedented out of anything — only
      // the over-deep-first-child reading applies; skip the sibling search
      // (a line at the blamed indent above it belongs to the previous
      // section).
      if (indent === 0) break;
      continue;
    }
    // Above the opener: a sibling at exactly the blamed line's indent
    // proves the opener was dedented out of that level.
    if (indent === propIndent && propIndent - opener.indent <= MAX_SIBLING_ALIGN) {
      return {
        markerLine: opener.line,
        markerKey: opener.key,
        delta: propIndent - opener.indent,
        reason: "align",
      };
    }
    // Leaving the opener's block ends the sibling search.
    if (indent < opener.indent) break;
  }
  // The competing reading: the opener sits where it belongs (the blamed
  // line is at its canonical child indent) and the block's first child is
  // what went too deep.
  if (opener === null || propIndent !== opener.indent + YAML_INDENT_STEP) return null;
  const child = contentLineBelow(readLine, opener.line);
  const childKey = child === null ? null : lineKeyToken(child.text);
  if (child === null || childKey === null) return null;
  const childIndent = indentOf(child.text);
  return childIndent > propIndent && childIndent - propIndent <= MAX_SIBLING_ALIGN
    ? {
        markerLine: child.line,
        markerKey: childKey,
        delta: propIndent - childIndent,
        reason: "align",
      }
    : null;
}

/**
 * Pinpoint the exact indentation fix behind a YAML indentation error.
 *
 * Shapes covered, in priority order:
 * - Blamed line is a `- ` marker whose properties below sit deeper than its
 *   content column (a marker dedented out of its list, blamed directly with
 *   `expected <block end>, but found '-'`): indent the marker to match.
 * - Blamed marker misaligned with the marker directly above it (one space
 *   off in either direction): re-indent the blamed marker to line up.
 * - Blamed line deeper than the valued `key: value` directly above it (the
 *   scanner reads it as a plain-scalar continuation): re-indent the pair
 *   back under the value-less `key:` it fell out of, or dedent the blamed
 *   line when there is no such block.
 * - Blamed line closing a value-less key's too-deep block: re-indent the
 *   key when a sibling above it sits at the blamed line's indent, else
 *   dedent the block's first child when the blamed line already sits at
 *   the key's canonical child indent.
 * - Blamed property line: the classic over-indent (`- platform: dht` then
 *   `    model:` — the scanner blames the property, the marker is what
 *   moves), a property at the markers' own indent (re-indent it to the
 *   content column), or a property out of line with siblings already
 *   sitting at the marker's content column (re-indent the blamed line).
 * - Blamed key strictly between a list's parent level and its markers
 *   (a section head nudged off the parent level): dedent it back.
 */
export function analyzeIndentMismatch(
  readLine: ReadLine,
  errorLine: number
): IndentMismatch | null {
  const errText = readLine(errorLine);
  if (errText === undefined || !errText.trim()) return null;
  const errIndent = indentOf(errText);
  const errMarker = parseListItemMarker(errText);
  if (errMarker) {
    const delta = firstPropertyDelta(readLine, errorLine, errMarker.contentCol);
    if (delta !== null && delta > 0) {
      return {
        markerLine: errorLine,
        markerKey: errMarker.key,
        delta,
        reason: "props-below",
      };
    }
    const align = siblingMarkerDelta(readLine, errorLine, errIndent);
    if (align !== null) {
      return {
        markerLine: errorLine,
        markerKey: errMarker.key,
        delta: align,
        reason: "align",
      };
    }
    return null;
  }
  const propIndent = errIndent;
  const prev = contentLineAbove(readLine, errorLine);
  const prevIndent = prev === null ? -1 : indentOf(prev.text);
  // The line directly above decides the reading: a shallower valued pair
  // makes the blamed line its plain-scalar continuation; a deeper line means
  // the blamed line closes a block, the signature of a misplaced value-less
  // opener (or its over-deep first child) above.
  if (
    prev &&
    !parseListItemMarker(prev.text) &&
    prevIndent < propIndent &&
    lineHasValue(prev.text)
  ) {
    return continuationScalarFix(readLine, errorLine, errText, propIndent, prev);
  }
  if (prevIndent > propIndent) {
    const openerFix = misplacedOpenerFix(readLine, errorLine, propIndent);
    if (openerFix) return openerFix;
  }
  // Nearest shallower non-marker line passed on the way up — when it sits
  // exactly at the marker's content column, the surrounding structure is
  // consistent and the blamed line is the one to move.
  let shallowerIndent: number | null = null;
  // Bound the walk so a huge doc can't turn one lint pass into a scan.
  for (let n = errorLine - 1; n >= 1 && n >= errorLine - WALK_BOUND; n--) {
    const text = readLine(n);
    if (text === undefined || isBlankOrComment(text)) continue;
    const marker = parseListItemMarker(text);
    if (!marker) {
      const indent = indentOf(text);
      if (indent < propIndent) {
        // A top-level line means we left every block without a marker. A
        // blamed key nudged just off column 0 that opens no deeper block is
        // a section head — dedent it back to the margin.
        if (indent === 0) {
          if (propIndent >= YAML_INDENT_STEP) return null;
          const errKey = lineKeyToken(errText);
          if (!errKey) return null;
          const next = contentLineBelow(readLine, errorLine);
          return next === null || indentOf(next.text) <= propIndent
            ? {
                markerLine: errorLine,
                markerKey: errKey,
                delta: -propIndent,
                reason: "align",
              }
            : null;
        }
        if (shallowerIndent === null) shallowerIndent = indent;
      }
      continue;
    }
    const errKey = lineKeyToken(errText);
    if (propIndent > marker.contentCol) {
      // Siblings already aligned at the content column — above or below the
      // blamed line — make the blamed line the odd one out; otherwise assume
      // the marker is what needs to move.
      const alignedAbove = shallowerIndent === marker.contentCol;
      const next =
        !alignedAbove && errKey && propIndent - marker.contentCol <= MAX_SIBLING_ALIGN
          ? contentLineBelow(readLine, errorLine)
          : null;
      if (
        errKey &&
        (alignedAbove || (next !== null && indentOf(next.text) === marker.contentCol))
      ) {
        return {
          markerLine: errorLine,
          markerKey: errKey,
          delta: marker.contentCol - propIndent,
          reason: "align",
        };
      }
      return {
        markerLine: n,
        markerKey: marker.key,
        delta: propIndent - marker.contentCol,
        reason: "props-below",
      };
    }
    const markerIndent = indentOf(text);
    // A property at the markers' own indent, or between it and the content
    // column, can't be part of the sequence — re-indent it to the content
    // column where the item's properties sit.
    if (propIndent < marker.contentCol && propIndent >= markerIndent && errKey) {
      return {
        markerLine: errorLine,
        markerKey: errKey,
        delta: marker.contentCol - propIndent,
        reason: "align",
      };
    }
    // A key strictly between the list's parent level and its markers closes
    // the list at a level nothing occupies — a section head nudged off the
    // parent level (` i2c:` between top-level sections). Dedent it back.
    const parentLevel = markerIndent - YAML_INDENT_STEP;
    if (
      errKey &&
      parentLevel >= 0 &&
      propIndent > parentLevel &&
      propIndent < markerIndent &&
      propIndent - parentLevel <= MAX_SIBLING_ALIGN
    ) {
      return {
        markerLine: errorLine,
        markerKey: errKey,
        delta: parentLevel - propIndent,
        reason: "align",
      };
    }
    return null;
  }
  return null;
}

/** Matches a value-less `- key:` list item (optionally with a comment). */
const BARE_ITEM_KEY_RE = /^\s*-\s+[^\s:#]+:\s*(?:#.*)?$/;

/**
 * A plain-language hint for the misindent behind "expected a dictionary.":
 * a value-less `- key:` whose following `- ` items sit at its content
 * column, making them the key's *value* instead of its list siblings.
 * Returns null when the line isn't that shape.
 */
export function describeNestedListValue(
  readLine: ReadLine,
  line: number,
  localize: LocalizeFunc
): string | null {
  const text = readLine(line);
  if (text === undefined || !BARE_ITEM_KEY_RE.test(text)) return null;
  const marker = parseListItemMarker(text);
  if (!marker) return null;
  for (let n = line + 1; n <= line + 50; n++) {
    const next = readLine(n);
    if (next === undefined) return null;
    if (!next.trim() || next.trimStart().startsWith("#")) continue;
    return parseListItemMarker(next) && indentOf(next) === marker.contentCol
      ? localize("yaml_editor.error_nested_list_hint", { key: marker.key })
      : null;
  }
  return null;
}

/** A named cause behind a validation error, with a one-click repair when
 *  the shape supports one. */
export interface ValueTypeCause {
  text: string;
  fix?: YamlAutoFix;
}

/**
 * The dash-space repair payload for a stuck-dash *key* at *fromIndent* on
 * *line* — one constructor so the message args, the dash-keeping `key`
 * the apply-site staleness check compares, and the fix shape can't drift
 * between the parse-error and validation-error surfaces.
 */
function dashSpaceCause(
  line: number,
  key: string,
  fromIndent: number,
  localize: LocalizeFunc
): ValueTypeCause {
  return {
    text: localize("yaml_editor.error_dash_space_fix", { line, key: key.slice(1) }),
    fix: { line, indent: 0, key, fromIndent, kind: "dash-space" },
  };
}

/**
 * Add the misindent / half-typed-key cause to a wrong-value-type
 * validation message ("expected a dictionary.") anchored at *line*: a
 * value-less `- key:` whose items landed one level deeper, a dash stuck
 * to its key (`-platform:` parses as a mapping key, so the section fails
 * schema validation instead of the YAML parse), a value-less `key:` with
 * nothing (or only comments) under it, or a bare word with no ':' (a
 * lone "le" under "logger:" parses as its string value).
 * Null when the anchored line is none of these shapes.
 */
export function describeValueTypeCause(
  readLine: ReadLine,
  line: number,
  localize: LocalizeFunc,
  message: string
): ValueTypeCause | null {
  const nested = describeNestedListValue(readLine, line, localize);
  if (nested) return { text: nested };
  const text = readLine(line);
  if (text === undefined) return null;
  const dashKey = botchedDashKey(text);
  if (dashKey !== null) {
    return dashSpaceCause(line, dashKey, indentOf(text), localize);
  }
  // Gated on the message: a value-less `key:` with no children is legal
  // YAML (`logger:`), so an error anchored there for another reason
  // ("'board' is a required option") must not pick up a remove-the-line hint.
  if (EXPECTED_DICT_RE.test(message)) {
    const emptyBlock = describeEmptyBlock(readLine, line, localize);
    if (emptyBlock) return emptyBlock;
  }
  const token = text.trim();
  if (token && !token.includes(":") && !token.startsWith("#") && !token.startsWith("-")) {
    return {
      text: localize("yaml_editor.error_missing_colon_hint", {
        line,
        key: token.length > 24 ? `${token.slice(0, 24)}…` : token,
      }),
    };
  }
  return null;
}

/** The wrong-value-type message the empty-block cause explains. */
const EXPECTED_DICT_RE = /expected a dictionary/i;

/**
 * Whether a comment line reads as a commented-out *child* of a key at
 * *keyIndent*: the `#` itself sits deeper, or the commented text is a
 * `key:` / `- ` line whose own indent sits deeper (a `#` jammed at column
 * 0 in front of a still-indented option — the hand-commented shape).
 */
function isCommentedChild(text: string, keyIndent: number): boolean {
  if (indentOf(text) > keyIndent) return true;
  const content = text.trimStart().replace(/^#+/, "");
  if (indentOf(content) <= keyIndent) return false;
  return lineKeyToken(content) !== null;
}

/**
 * Classify the empty-block shape at *line*: a value-less plain `key:`
 * whose children are all commented out ("comment-out") or absent
 * entirely ("remove-line"); null when the key has any real child, or
 * the line isn't a value-less plain key. Also the apply site's stale
 * check for the destructive fixes — the diagnosed line must still hold
 * the exact shape the fix was built for.
 */
export function emptyBlockFixKind(
  readLine: ReadLine,
  line: number
): "comment-out" | "remove-line" | null {
  const text = readLine(line);
  if (text === undefined || parseListItemMarker(text)) return null;
  if (valuelessKeyOf(stripComment(text)) === null) return null;
  const keyIndent = indentOf(text);
  let sawComment = false;
  for (let n = line + 1; n <= line + WALK_BOUND; n++) {
    const next = readLine(n);
    if (next === undefined) break;
    if (!next.trim()) continue;
    if (next.trimStart().startsWith("#")) {
      sawComment ||= isCommentedChild(next, keyIndent);
      continue;
    }
    if (indentOf(next) > keyIndent) return null;
    break;
  }
  return sawComment ? "comment-out" : "remove-line";
}

/**
 * The empty-block cause behind "expected a dictionary.": the hint names
 * the commented-out or empty shape and carries the matching repair
 * (comment the key out too, or remove the line).
 */
function describeEmptyBlock(
  readLine: ReadLine,
  line: number,
  localize: LocalizeFunc
): ValueTypeCause | null {
  const kind = emptyBlockFixKind(readLine, line);
  if (kind === null) return null;
  const text = readLine(line);
  const key = valuelessKeyOf(stripComment(text ?? ""));
  if (key === null) return null;
  return {
    text: localize(
      kind === "comment-out"
        ? "yaml_editor.error_commented_block_hint"
        : "yaml_editor.error_empty_block_hint",
      { line, key }
    ),
    fix: { line, indent: 0, key, fromIndent: indentOf(text ?? ""), kind },
  };
}

/** Matches `[X] is an invalid option for [Y].` with any trailing hint
 *  ("Please check the indentation." / "Did you mean …?" / none). */
const INVALID_OPTION_RE = /^\[([^\]]+)\] is an invalid option for \[([^\]]+)\]\./;

/** Parse an ESPHome invalid-option message into its key and parent. */
export function parseInvalidOptionMessage(
  message: string
): { key: string; parent: string } | null {
  const hit = message.match(INVALID_OPTION_RE);
  return hit ? { key: hit[1], parent: hit[2] } : null;
}

/** A blamed key one indent level away from the value-less opener above it,
 *  with the signed re-indent that would repair it: positive nests the line
 *  under a sibling opener, negative dedents it out of its parent. */
export interface DedentedOptionCandidate {
  openerLine: number;
  openerKey: string;
  delta: number;
  fromIndent: number;
}

/** A value-less opener located by ``findValuelessOpener``, with the walk
 *  facts the two misnested-option analyzers derive their deltas from. */
interface OpenerAbove {
  openerLine: number;
  openerKey: string;
  openerIndent: number;
  blamedIndent: number;
  /** Shallowest strictly-deeper indent passed on the way up — the opener's
   *  existing children — or null when none. */
  minDeeper: number | null;
}

/**
 * Shared walk behind the misnested-option analyzers: from the blamed
 * `key:` line, scan upward past blanks, comments, and deeper lines to the
 * value-less opener the key is one level away from — the *sibling* at the
 * blamed indent (nest) or the enclosing *parent* at a shallower one
 * (dedent). Bails on list markers, valued deciders, and (sibling mode) a
 * shallower line first: each means a one-line re-indent would attach the
 * key to the wrong node.
 */
function findValuelessOpener(
  readLine: ReadLine,
  blamedLine: number,
  blamedKey: string,
  opener: "sibling" | "parent"
): OpenerAbove | null {
  const text = readLine(blamedLine);
  if (text === undefined || parseListItemMarker(text)) return null;
  if (lineKeyToken(text) !== blamedKey) return null;
  const blamedIndent = indentOf(text);
  if (blamedIndent === 0) return null;
  let minDeeper: number | null = null;
  for (let n = blamedLine - 1; n >= 1 && n >= blamedLine - WALK_BOUND; n--) {
    const above = readLine(n);
    if (above === undefined) return null;
    if (isBlankOrComment(above)) continue;
    if (parseListItemMarker(above)) return null;
    const indent = indentOf(above);
    if (indent > blamedIndent) {
      minDeeper = minDeeper === null ? indent : Math.min(minDeeper, indent);
      continue;
    }
    if (indent === blamedIndent) {
      if (opener === "parent") continue;
    } else if (opener === "sibling") {
      return null;
    }
    const openerKey = valuelessKeyOf(above);
    if (openerKey === null) return null;
    return { openerLine: n, openerKey, openerIndent: indent, blamedIndent, minDeeper };
  }
  return null;
}

/**
 * Detect the dedented-option shape behind an invalid-option error: the
 * blamed `key:` sits at the same indent as a value-less opener above it
 * (`encryption:` then `key:`), separated only by the opener's deeper
 * children, blanks, or comments.
 */
export function analyzeDedentedOption(
  readLine: ReadLine,
  blamedLine: number,
  blamedKey: string
): DedentedOptionCandidate | null {
  const hit = findValuelessOpener(readLine, blamedLine, blamedKey, "sibling");
  if (hit === null) return null;
  // The opener's existing children set the target indent; a childless
  // opener gets the canonical step.
  const target = hit.minDeeper ?? hit.blamedIndent + YAML_INDENT_STEP;
  return {
    openerLine: hit.openerLine,
    openerKey: hit.openerKey,
    delta: target - hit.blamedIndent,
    fromIndent: hit.blamedIndent,
  };
}

/**
 * The mirror shape: the blamed `key:` was over-indented into the block of
 * the value-less opener above it (`framework:` swallowing `variant:`), so
 * it reads as the opener's child instead of its sibling. Only offered when
 * the blamed line closes its block (the next content line sits at or above
 * the opener's indent) — dedenting a mid-block line would split the block.
 */
export function analyzeOverIndentedOption(
  readLine: ReadLine,
  blamedLine: number,
  blamedKey: string
): DedentedOptionCandidate | null {
  const hit = findValuelessOpener(readLine, blamedLine, blamedKey, "parent");
  if (hit === null) return null;
  const next = contentLineBelow(readLine, blamedLine);
  if (next !== null && indentOf(next.text) > hit.openerIndent) return null;
  return {
    openerLine: hit.openerLine,
    openerKey: hit.openerKey,
    delta: hit.openerIndent - hit.blamedIndent,
    fromIndent: hit.blamedIndent,
  };
}

/** ReadLine over an in-memory buffer; splits once, indexes 1-based. */
export function lineAccessorFor(content: string): ReadLine {
  const lines = content.split("\n");
  return (line1) => (line1 >= 1 && line1 <= lines.length ? lines[line1 - 1] : undefined);
}

/** A one-click one-line repair: re-indent `line` by the signed `indent`
 *  delta, or a kind-specific edit — insert the missing space after a list
 *  dash, comment the line out, or delete it. */
export interface YamlAutoFix {
  line: number;
  /** Signed leading-space delta; 0 (unused) for the kind-specific edits. */
  indent: number;
  /** The target line's own key, so the apply site can confirm the line still
   *  targets the same item after edits shift line numbers. */
  key: string;
  /** The target line's indent when the fix was computed; the apply site
   *  refuses when the line no longer starts there. */
  fromIndent: number;
  /** Absent means re-indent; "dash-space" inserts a space after the dash,
   *  "comment-out" inserts `# ` at the line's indent, "remove-line" deletes
   *  the whole line. */
  kind?: "dash-space" | "comment-out" | "remove-line";
}

/** A humanized YAML error: display text, best line to jump to, optional auto-fix. */
export interface YamlErrorDescription {
  text: string;
  jumpLine: number | null;
  fix?: YamlAutoFix;
  /** Overrides the squiggle's line when the scanner's problem mark blames
   *  the wrong place (e.g. a missing-colon error marks lines later). */
  squiggleLine?: number;
}

/**
 * Rewrite a cryptic PyYAML scanner message into a plain-language fix.
 *
 * The scanner blames where parsing broke, not where the human erred, so
 * name the real cause and, for the over-indented list-item case, the
 * exact line + space delta to fix (with an auto-fix). Covers the common
 * scanner errors — indentation, tabs, unterminated strings, duplicate
 * keys, stray symbols — falling back to the sanitized original for the
 * rest. `jumpLine` is the best line to scroll to (the fix site when known).
 */
export function describeYamlError(
  message: string,
  pos: { line: number; col: number | null } | null,
  localize: LocalizeFunc,
  readLine?: ReadLine
): YamlErrorDescription {
  const fallback = sanitizeMessage(message.trim()) || "Invalid YAML";
  const line = pos?.line ?? null;
  if (line === null) return { text: fallback, jumpLine: null };
  const hint = (key: string): YamlErrorDescription => ({
    text: localize(key, { line }),
    jumpLine: line,
  });
  const lower = message.toLowerCase();

  // A stray tab or reserved symbol where a token was expected. ESPHome falls
  // back to pyyaml's pure-Python loader for readable errors, which names the
  // char via ``%r`` — a tab shows as the literal ``'\t'`` repr.
  if (lower.includes("cannot start any token")) {
    return message.includes("'\\t'")
      ? hint("yaml_editor.error_tab_hint")
      : hint("yaml_editor.error_char_hint");
  }
  // Unterminated quoted scalar — a `"` or `'` opened but never closed.
  if (
    lower.includes("unexpected end of stream") ||
    lower.includes("while scanning a quoted scalar")
  ) {
    return hint("yaml_editor.error_unterminated_string_hint");
  }
  // A bare word where a `key: value` was expected: the scanner reads it as
  // a "simple key" and then never finds the ':', blaming wherever it gave
  // up — often lines later. The context mark points at the word itself;
  // when that line really has no ':', name it instead of the indent hint.
  if (lower.includes("could not find expected ':'") && lower.includes("simple key")) {
    const ctx = parseYamlErrorContext(message);
    const token = ctx && readLine ? readLine(ctx.line)?.trim() : undefined;
    if (ctx && token && !token.includes(":")) {
      return {
        text: localize("yaml_editor.error_missing_colon_hint", {
          line: ctx.line,
          key: token.length > 24 ? `${token.slice(0, 24)}…` : token,
        }),
        jumpLine: ctx.line,
        squiggleLine: ctx.line,
      };
    }
  }
  // Same option set twice in a block.
  if (lower.includes("duplicate key")) {
    return hint("yaml_editor.error_duplicate_key_hint");
  }
  // Unclosed flow collection — a `[ ... ]` list or `{ ... }` mapping (both
  // loaders word it "while parsing a flow sequence/mapping").
  if (lower.includes("while parsing a flow")) {
    return hint("yaml_editor.error_flow_hint");
  }
  // Indentation family: the over-indented list-item swallow and its structural
  // cousins. Try to pinpoint the exact fix from the document.
  if (
    lower.includes("mapping values are not allowed") ||
    lower.includes("could not find expected ':'") ||
    lower.includes("expected <block end>")
  ) {
    // A dash stuck to its key (`-platform:`) produces these same errors but
    // needs a space, not an indent change — check it before the indent walk.
    const dash = readLine ? missingDashSpace(readLine, line) : null;
    if (dash) {
      return {
        ...dashSpaceCause(dash.line, dash.key, dash.fromIndent, localize),
        jumpLine: dash.line,
        squiggleLine: dash.line,
      };
    }
    const fix = readLine ? analyzeIndentMismatch(readLine, line) : null;
    if (fix) {
      // "- key" for a list marker, plain "key" for a property line, so the
      // message names the line the way the user sees it.
      const targetText = readLine?.(fix.markerLine) ?? "";
      const display = parseListItemMarker(targetText)
        ? `- ${fix.markerKey}`
        : fix.markerKey;
      const messageKey =
        fix.reason === "props-below"
          ? "yaml_editor.error_indent_fix"
          : fix.delta > 0
            ? "yaml_editor.error_misaligned_indent_fix"
            : "yaml_editor.error_misaligned_dedent_fix";
      return {
        text: localize(messageKey, {
          line: fix.markerLine,
          // error_indent_fix's template writes the "- " itself.
          key: fix.reason === "props-below" ? fix.markerKey : display,
          spaces: Math.abs(fix.delta),
        }),
        jumpLine: fix.markerLine,
        fix: {
          line: fix.markerLine,
          indent: fix.delta,
          key: fix.markerKey,
          fromIndent: indentOf(targetText),
        },
      };
    }
    return hint("yaml_editor.error_indent_hint");
  }
  return { text: fallback, jumpLine: line };
}
