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

/**
 * First line (1-indexed) at or below ``openerLine`` whose indent is
 * ``<= openerIndent`` — i.e. where the opener's scope ends. Returns
 * ``lines.length + 1`` when the scope runs to EOF.
 *
 * ``searchFrom`` / ``searchTo`` bound the scan (both 1-indexed, inclusive)
 * for the sticky overlay's hot path: the caller knows the exit can only
 * fall at/after the top visible line (an ancestor encloses it, so no exit
 * lies between the opener and there) and only *matters* while it's within
 * the rendered viewport (an off-screen exit drives no slide-out). When no
 * exit is found within the bounded window, ``lines.length + 1`` is
 * returned — the caller treats that as "off-screen", which is correct
 * since any real exit below the window can't be near the viewport top.
 * The defaults scan the whole document (unbounded, original behaviour).
 */
export function findScopeExitLine(
  lines: string[],
  openerLine: number,
  openerIndent: number,
  searchFrom = openerLine + 1,
  searchTo = lines.length
): number {
  const from = Math.max(openerLine, searchFrom - 1);
  const to = Math.min(lines.length, searchTo);
  for (let i = from; i < to; i++) {
    const stripped = structuralStripped(lines[i]);
    if (!stripped) continue;
    if (indentOf(stripped) <= openerIndent) return i + 1;
  }
  return lines.length + 1;
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
  // The bound is the indent of the relevant *meaningful* line:
  //   - non-blank, non-banner-comment topVisibleLine → its own
  //     indent.
  //   - blank / banner topVisibleLine → the NEXT meaningful line
  //     below it (the content being scrolled into), so the chain
  //     drops a scope as soon as a boundary blank/comment reaches
  //     the top rather than holding the deeper scope one line too
  //     long. Bounding to that line's indent (not ``Infinity``)
  //     still keeps the walk from picking up every leaf.
  let targetIndent: number;
  let walkFrom: number;
  const topStripped = structuralStripped(lines[topVisibleLine - 1]);
  if (topStripped) {
    targetIndent = indentOf(topStripped);
    walkFrom = topVisibleLine - 2;
  } else {
    // Blank / banner — adopt the indent of the most recent meaningful
    // line above. The sticky overlay's scope walk probes this function
    // at the bottom of its growing row stack, so a blank probe should
    // resolve to the scope it sits inside (the line above it), letting
    // the walk descend correctly into nested blocks.
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
