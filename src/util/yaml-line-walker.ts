/**
 * Regex line-walkers for YAML — fallback for the AST helpers in
 * ``yaml-ast.ts`` when partial / unparseable input means the
 * Lezer parse tree can't answer a structural question.
 *
 * The multi-line walkers read lines off CodeMirror's ``Text``
 * (``doc.line(n)``), scanning only the bounded range around the cursor —
 * never the whole document. The completion source prefers the AST answer
 * and falls back to these where the parse tree is silent.
 *
 * Anything structural that needs to span multiple lines belongs
 * in ``yaml-ast.ts``; anything single-line-text-shape stays here.
 */

import type { Text } from "@codemirror/state";

// ─── Shared regex constants ─────────────────────────────────────────

/** ``# comment`` boundary — must be at line start or after whitespace.
 *  ``#RRGGBB`` colour values inside a scalar are valid YAML, so the
 *  boundary check rules them out. */
export const RE_INLINE_COMMENT_BOUNDARY = /(^|\s)#/;

/** Whole-line pair shape: optional list-item dash, key, ``:``,
 *  optional value text. Captures ``(key, restOfLine)``. The key
 *  accepts ``.`` so dotted action / filter / condition labels
 *  (``globals.set``, ``logger.log``, ``binary_sensor.is_on``) are
 *  recognised as parent keys when the cursor is inside their
 *  argument mapping — without that, ``findParentKey`` walks past
 *  the action and the action-arg completion can't fire. */
export const RE_PAIR_LINE = /^\s*(?:-\s+)?([A-Za-z0-9_.]+)\s*:\s*(.*)$/;

/** Column-0 pair: key starts at indent 0. Used to identify
 *  top-level component blocks when walking up from the cursor. */
export const RE_TOP_LEVEL_KEY = /^([A-Za-z0-9_]+)\s*:/;

/** ``platform: gpio`` sibling reader. Same shape as
 *  ``RE_PAIR_LINE`` but constrains the key to literal
 *  ``platform``. Accepts unquoted (``platform: gpio``),
 *  double-quoted (``platform: "dht"``) and single-quoted
 *  (``platform: 'dht'``) forms — the AST handles quotes via
 *  Lezer's ``QuotedLiteral`` node, but at half-typed pairs the
 *  regex walker is the only path and writers commonly quote
 *  platform names. ``readPlatformSibling`` strips the quotes
 *  before returning. */
export const RE_PLATFORM_SIBLING =
  /^\s*(?:-\s+)?platform\s*:\s*("[^"]*"|'[^']*'|[A-Za-z0-9_]+)\s*$/;

// ─── Single-line helpers ─────────────────────────────────────────────

/** Count the leading-space indent of *line*. */
export function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  return i;
}

/** Strip inline ``# comment`` and trailing whitespace from *line*.
 *  ``#`` inside a scalar without a leading space (e.g. a colour
 *  literal) is preserved. */
export function stripComment(line: string): string {
  const m = line.match(RE_INLINE_COMMENT_BOUNDARY);
  if (!m) return line.trimEnd();
  return line.slice(0, m.index! + m[0].length - 1).trimEnd();
}

// ─── Multi-line walkers ──────────────────────────────────────────────

export interface ParentKey {
  key: string;
  indent: number;
  lineIdx: number;
}

/**
 * Walk back from *lineIdx* to find the nearest key-line whose
 * indent is strictly less than *belowIndent*. The parent block of
 * the cursor.
 */
export function findParentKey(
  doc: Text,
  lineIdx: number,
  belowIndent: number
): ParentKey | null {
  for (let i = lineIdx - 1; i >= 0; i--) {
    const stripped = stripComment(doc.line(i + 1).text);
    if (!stripped.trim()) continue;
    const ind = indentOf(stripped);
    if (ind >= belowIndent) continue;
    const m = stripped.match(RE_PAIR_LINE);
    if (m) return { key: m[1], indent: ind, lineIdx: i };
  }
  return null;
}

/**
 * When the caret sits on a wholly blank line, return that line's 0-based
 * index and the caret's indent — the inputs the indent walkers need. The AST
 * can't anchor on such a line (no Pair), so callers fall back to the
 * indent-based walkers. ``null`` otherwise (including a caret in the
 * indentation of a non-blank ``key:`` line, which the AST resolves fine).
 */
export function blankLineContext(
  doc: Text,
  pos: number
): { lineIdx: number; indent: number } | null {
  const line = doc.lineAt(pos);
  // The whole line must be blank, not just the text before the caret — a
  // caret in the indentation of an existing ``key:`` line is not a blank line
  // (the AST resolves it fine), and treating it as blank would switch callers
  // to the indent scan and miss that line's key.
  if (line.text.trim() !== "") return null;
  return { lineIdx: line.number - 1, indent: pos - line.from };
}

/**
 * Build the full ancestor key chain (top-down) for a line by walking
 * outward through strictly-decreasing indents — e.g. a line under
 * ``esp32:`` → ``framework:`` yields ``["esp32", "framework"]``. Unlike
 * the AST ``getKeyPath``, this is blank-line tolerant, so it resolves the
 * nested context of an empty indented line (which has no Pair to anchor
 * on). Returns ``[]`` at the top level.
 */
export function keyPathByIndent(doc: Text, lineIdx: number, indent: number): string[] {
  const chain: string[] = [];
  let below = indent;
  let from = lineIdx;
  for (;;) {
    const p = findParentKey(doc, from, below);
    if (!p) break;
    chain.push(p.key);
    below = p.indent;
    from = p.lineIdx;
  }
  return chain.reverse();
}

/**
 * Collect the keys of the mapping at *indent* surrounding *lineIdx* by
 * scanning lines, not the AST. Used when the cursor is on a blank line —
 * where the AST has no Pair to anchor on — so the already-set-key filter
 * still works. Bounded to the enclosing block: stops at the first line that
 * dedents below *indent* in each direction; deeper lines (children of a
 * sibling) are skipped.
 */
export function collectSiblingKeysByIndent(
  doc: Text,
  lineIdx: number,
  indent: number
): Set<string> {
  const out = new Set<string>();
  const scan = (from: number, step: number): void => {
    for (let i = from; i >= 0 && i < doc.lines; i += step) {
      const stripped = stripComment(doc.line(i + 1).text);
      if (!stripped.trim()) continue;
      const ind = indentOf(stripped);
      if (ind < indent) break;
      if (ind === indent) {
        const m = stripped.match(RE_PAIR_LINE);
        if (m) out.add(m[1]);
      }
    }
  };
  scan(lineIdx - 1, -1);
  scan(lineIdx + 1, 1);
  return out;
}

/** Walk back from *lineIdx* to the first column-0 ``key:`` line. */
export function findTopLevelBlock(doc: Text, lineIdx: number): string | null {
  for (let i = lineIdx - 1; i >= 0; i--) {
    const stripped = stripComment(doc.line(i + 1).text);
    if (!stripped.trim()) continue;
    if (indentOf(stripped) !== 0) continue;
    const m = stripped.match(RE_TOP_LEVEL_KEY);
    if (m) return m[1];
  }
  return null;
}

/**
 * Look for a ``platform:`` sibling at the same indent level as
 * the cursor. Walks up first to find the start of the current
 * list item or mapping, then scans forward.
 *
 * NOTE: This is the legacy fallback. The AST-based
 * ``resolveBundleContext`` (in ``yaml-ast.ts``) handles the
 * list-item-indent case more robustly — when ``- platform:
 * gpio`` is the list-item header, its dash sits at a shallower
 * indent than the body, and this walker breaks early. Prefer
 * the AST answer; this exists for partial-edit positions where
 * the parse tree doesn't yet have the structure.
 */
export function readPlatformSibling(
  doc: Text,
  lineIdx: number,
  indent: number
): string | null {
  // First pass: scan back for *any* ``- platform: <value>`` at a
  // shallower indent than the cursor. This catches the
  // deeply-nested case where the cursor sits inside ``filters:``
  // / ``then:`` / etc. — the list-item dash that declares the
  // platform may be several indent levels up. Without this scan,
  // the walker stops at the immediate enclosing block and misses
  // the outer platform declaration entirely.
  for (let i = lineIdx - 1; i >= 0; i--) {
    const raw = doc.line(i + 1).text;
    const stripped = stripComment(raw);
    if (!stripped.trim()) continue;
    const ind = indentOf(stripped);
    if (ind >= indent) continue;
    if (!/^\s*-\s/.test(raw)) continue;
    const m = stripped.match(RE_PLATFORM_SIBLING);
    if (m) return unquote(m[1]);
  }
  // Second pass: same-indent list-item header (``- platform:
  // gpio`` then siblings on the lines below). Walk up to the
  // top-of-block, then forward-scan for the ``platform:`` sibling.
  let topOfBlock = lineIdx;
  for (let i = lineIdx - 1; i >= 0; i--) {
    const raw = doc.line(i + 1).text;
    const stripped = stripComment(raw);
    if (!stripped.trim()) continue;
    const ind = indentOf(stripped);
    if (ind < indent) break;
    if (ind === indent) {
      topOfBlock = i;
      if (/^\s*-\s/.test(raw)) break;
    }
  }
  for (let i = topOfBlock; i < doc.lines; i++) {
    const stripped = stripComment(doc.line(i + 1).text);
    if (!stripped.trim()) continue;
    const ind = indentOf(stripped);
    if (i !== topOfBlock && ind < indent) break;
    const m = stripped.match(RE_PLATFORM_SIBLING);
    if (m) return unquote(m[1]);
  }
  return null;
}

/** Strip a single layer of matched single or double quotes from
 *  *value*. Mirrors the AST's ``readLiteralText`` so the regex
 *  walker and the AST agree on the user-facing string. */
function unquote(value: string): string {
  if (value.length < 2) return value;
  const q = value[0];
  if ((q === '"' || q === "'") && value[value.length - 1] === q) {
    return value.slice(1, -1);
  }
  return value;
}
