/**
 * Regex line-walkers for YAML — fallback for the AST helpers in
 * ``yaml-ast.ts`` when partial / unparseable input means the
 * Lezer parse tree can't answer a structural question.
 *
 * These look only at the raw text of individual lines, so they're
 * insulated from the editor state and can be exercised in unit
 * tests without an ``EditorState`` mock. The completion source's
 * ``resolveCompletionContext`` prefers the AST answer and falls
 * back to these for the corner cases where the AST is silent.
 *
 * Anything structural that needs to span multiple lines belongs
 * in ``yaml-ast.ts``; anything single-line-text-shape stays here.
 */

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
  lines: string[],
  lineIdx: number,
  belowIndent: number,
): ParentKey | null {
  for (let i = lineIdx - 1; i >= 0; i--) {
    const stripped = stripComment(lines[i]);
    if (!stripped.trim()) continue;
    const ind = indentOf(stripped);
    if (ind >= belowIndent) continue;
    const m = stripped.match(RE_PAIR_LINE);
    if (m) return { key: m[1], indent: ind, lineIdx: i };
  }
  return null;
}

/** Walk back from *lineIdx* to the first column-0 ``key:`` line. */
export function findTopLevelBlock(
  lines: string[],
  lineIdx: number,
): string | null {
  for (let i = lineIdx - 1; i >= 0; i--) {
    const stripped = stripComment(lines[i]);
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
  lines: string[],
  lineIdx: number,
  indent: number,
): string | null {
  // First pass: scan back for *any* ``- platform: <value>`` at a
  // shallower indent than the cursor. This catches the
  // deeply-nested case where the cursor sits inside ``filters:``
  // / ``then:`` / etc. — the list-item dash that declares the
  // platform may be several indent levels up. Without this scan,
  // the walker stops at the immediate enclosing block and misses
  // the outer platform declaration entirely.
  for (let i = lineIdx - 1; i >= 0; i--) {
    const raw = lines[i];
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
    const raw = lines[i];
    const stripped = stripComment(raw);
    if (!stripped.trim()) continue;
    const ind = indentOf(stripped);
    if (ind < indent) break;
    if (ind === indent) {
      topOfBlock = i;
      if (/^\s*-\s/.test(raw)) break;
    }
  }
  for (let i = topOfBlock; i < lines.length; i++) {
    const stripped = stripComment(lines[i]);
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
