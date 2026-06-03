import { indentOf, stripComment } from "./yaml-line-walker.js";

export interface StickyScopeLine {
  /** 1-indexed line number (CodeMirror convention). */
  lineNumber: number;
  /** Leading-space indent of the line. */
  indent: number;
  /** Raw line text — exactly what the editor would render. */
  text: string;
}

/**
 * ``stripComment(raw)`` when ``raw`` participates in scope structure,
 * else ``null``. Blank lines and column-0 banner comments (``# ...``)
 * decorate the next section rather than belonging to a scope, so every
 * walk in this file skips them uniformly — matching the trim policy in
 * ``parseYamlTopLevelSections``. Returns the stripped text (not a bare
 * boolean) so callers can read its indent without re-stripping.
 */
function structuralStripped(raw: string): string | null {
  if (raw.startsWith("#")) return null;
  const stripped = stripComment(raw);
  return stripped.trim() ? stripped : null;
}

export function findScopeExitLine(
  lines: string[],
  openerLine: number,
  openerIndent: number
): number {
  for (let i = openerLine; i < lines.length; i++) {
    const stripped = structuralStripped(lines[i]);
    if (!stripped) continue;
    if (indentOf(stripped) <= openerIndent) return i + 1;
  }
  return lines.length + 1;
}

/**
 * True when ``lineNumber`` (1-indexed) is a "scope opener" — the
 * next non-blank, non-banner-comment line below it is at a
 * strictly deeper indent, meaning the line below lives INSIDE
 * the line's block.
 *
 * Used by the sticky-scroll overlay to drive the slide-in
 * animation for the topmost rendered line: when that line is a
 * scope opener, the overlay appends it as the deepest row and
 * runs a one-row-height slide-in window as ``scrollTop`` traverses
 * the opener's own line height. Without this, a brand-new scope
 * row would pop in abruptly the instant ``lineBlockAtHeight``
 * advances past the opener — the body content visibly jumping
 * by one row to make room for the freshly-added pin.
 *
 * Mirrors the blank-line / banner-comment skip policy used
 * everywhere else in this file, so the "scope opener" reading
 * agrees with what ``computeStickyScope`` and
 * ``findScopeExitLine`` would walk.
 */
export function isScopeOpener(lines: string[], lineNumber: number): boolean {
  if (lineNumber < 1 || lineNumber > lines.length) return false;
  const stripped = structuralStripped(lines[lineNumber - 1]);
  if (!stripped) return false;
  const myIndent = indentOf(stripped);
  for (let i = lineNumber; i < lines.length; i++) {
    const nextStripped = structuralStripped(lines[i]);
    if (!nextStripped) continue;
    return indentOf(nextStripped) > myIndent;
  }
  return false;
}

/**
 * Returns the ordered chain of enclosing-scope ANCESTORS for
 * ``topVisibleLine`` (1-indexed). The result is outermost-first:
 * the column-0 top-level key at index 0, then progressively
 * deeper scopes, ending at ``topVisibleLine``'s immediate parent.
 *
 * ``topVisibleLine`` itself is NOT in the result — it's still
 * rendered in the doc body just below the overlay (the line at
 * ``scrollTop`` sits behind the overlay's top edge), so pinning
 * it as well would put the same text in two places on screen.
 * The "pin the header you just scrolled past" reading is
 * preserved naturally: as the user scrolls one more line down,
 * the previous line becomes the new ``topVisibleLine``'s
 * ancestor and joins the chain at exactly the right scroll
 * position — no special-case logic, no visible duplication.
 *
 * Returns an empty array when ``topVisibleLine`` has no
 * ancestor — it's at indent 0 (top-level key), out of range, or
 * the document starts at ``topVisibleLine``. Blank lines and
 * column-0 banner comments (``# ...``) are skipped during the
 * walk — they decorate the next section rather than belonging
 * to any scope, matching the trim policy in
 * ``parseYamlTopLevelSections``.
 */
export function computeStickyScope(
  lines: string[],
  topVisibleLine: number
): StickyScopeLine[] {
  if (topVisibleLine < 1 || topVisibleLine > lines.length) return [];

  // Anchor the chain by an indent bound. The walk-back below
  // includes lines with indent *strictly less* than this bound,
  // so the bound determines which ancestors qualify. Important:
  // we DO NOT include ``topVisibleLine`` itself in the chain
  // even when it's a scope opener — that line is still visible
  // at the top of the doc body just below the overlay, and
  // pinning it as well produces the visible duplication
  // ("blinking") the user sees as they scroll past it.
  //
  // The bound is the indent of the topmost *meaningful* line:
  //   - non-blank, non-banner-comment topVisibleLine → its own
  //     indent.
  //   - blank / banner topVisibleLine → walk back to the most
  //     recent meaningful line and use ITS indent. This keeps
  //     the chain stable as scrollTop crosses a blank line in
  //     the middle of a scope: without it, ``targetIndent =
  //     Infinity`` would let the walk pick up every leaf along
  //     the way, making the chain explode by 1–2 rows on every
  //     blank line and producing the visible trembling.
  let targetIndent: number;
  let walkFrom: number;
  const topStripped = structuralStripped(lines[topVisibleLine - 1]);
  if (topStripped) {
    targetIndent = indentOf(topStripped);
    walkFrom = topVisibleLine - 2;
  } else {
    // Blank / banner — find the most recent meaningful line above and
    // adopt its indent. The walk then proceeds from immediately above
    // that line, so the line itself isn't re-pushed.
    let prev = topVisibleLine - 1;
    while (prev > 0 && !structuralStripped(lines[prev - 1])) prev--;
    if (prev === 0) return [];
    targetIndent = indentOf(stripComment(lines[prev - 1]));
    walkFrom = prev - 2;
  }

  const scope: StickyScopeLine[] = [];
  for (let i = walkFrom; i >= 0; i--) {
    const stripped = structuralStripped(lines[i]);
    if (!stripped) continue;
    const ind = indentOf(stripped);
    if (ind >= targetIndent) continue;
    scope.push({
      lineNumber: i + 1,
      indent: ind,
      text: lines[i],
    });
    targetIndent = ind;
    if (ind === 0) break;
  }
  // Innermost-last after the walk; reverse so the overlay
  // renders outermost-first (top of stack = root scope).
  return scope.reverse();
}
