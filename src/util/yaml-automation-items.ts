/**
 * Item enumeration and key reading for the top-level automation blocks the
 * fallback parser lists: script, interval and api.actions rows.
 */

import { isBlankOrCommentLine, LIST_ITEM_START_RE } from "./yaml-section-lexer.js";
import { lineIndent } from "./yaml-sections-core.js";

/** A dash line with inline content — the match length is the item's
 *  content column. */
const _DASH_CONTENT_RE = /^\s*-\s+(?=\S)/;

/** Compiled once per key: the dash-line form ('- id: my_alarm') and the
 *  indented sibling form of a key with its value's quotes peeled. */
const _KEY_VALUE_RES = new Map<string, { dash: RegExp; sibling: RegExp }>();

/** The whole block as one item when its first body line is not a list
 *  row (a mapping-form block), else null; the reader takes the header line
 *  as its start and pins to the first body line, as the backend's row does. */
export function mappingFormItem(
  lines: string[],
  blockFromLine: number,
  blockToLine: number
): { fromLine: number; toLine: number } | null {
  for (let i = blockFromLine; i < blockToLine && i < lines.length; i++) {
    if (isBlankOrCommentLine(lines[i])) continue;
    return LIST_ITEM_START_RE.test(lines[i])
      ? null
      : { fromLine: blockFromLine, toLine: blockToLine };
  }
  return null;
}

/** List items (``- key: value`` ...) directly inside a top-level
 *  block. Nested list markers (the ``- logger.log`` inside a
 *  ``then:`` clause) are deeper and skipped by pinning to the
 *  block's first-row dash indent. */
export function enumerateListItems(
  lines: string[],
  blockFromLine: number,
  blockToLine: number
): Array<{ fromLine: number; toLine: number }> {
  const out: Array<{ fromLine: number; toLine: number }> = [];
  let topIndent: number | null = null;
  let inItem: { fromLine: number } | null = null;
  for (let i = blockFromLine; i < blockToLine && i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const dash = line.match(/^(\s*)-\s/);
    if (!dash) continue;
    const indent = dash[1].length;
    if (topIndent === null) topIndent = indent;
    // Skip dashes deeper than the block's first row — those are
    // nested action lists inside ``then:`` clauses, not block-level
    // items.
    if (indent > topIndent) continue;
    if (inItem) out.push({ fromLine: inItem.fromLine, toLine: i });
    inItem = { fromLine: i + 1 };
  }
  if (inItem) out.push({ fromLine: inItem.fromLine, toLine: blockToLine });
  return out;
}

/** Leading-whitespace width of a ``- `` list-item dash on *line*
 *  (0 when the line isn't a dash item). */
function _dashIndent(line: string): number {
  return line.match(/^(\s*)-/)?.[1].length ?? 0;
}

function _keyValueRes(key: string): { dash: RegExp; sibling: RegExp } {
  let res = _KEY_VALUE_RES.get(key);
  if (!res) {
    const value = `${key}:\\s*["']?([^"'\\s]+)["']?`;
    res = {
      dash: new RegExp(`^\\s*-\\s*${value}`),
      sibling: new RegExp(`^\\s+${value}`),
    };
    _KEY_VALUE_RES.set(key, res);
  }
  return res;
}

export function readKeyOnLine(
  lines: string[],
  fromLine: number,
  key: string
): string | null {
  const target = lines[fromLine - 1];
  const { dash, sibling: siblingRe } = _keyValueRes(key);
  const m = target.match(dash);
  if (m) return m[1];
  const dashIndent = _dashIndent(target);
  // Siblings of the item's own mapping all sit at one column: the
  // dash line's content column, or the first body line's for a bare
  // dash. Pinning to it keeps a same-named key nested deeper in the
  // body (a homeassistant.action call, a then block) from winning.
  let childIndent = target.match(_DASH_CONTENT_RE)?.[0].length ?? null;
  for (let i = fromLine; i < lines.length; i++) {
    const line = lines[i];
    if (isBlankOrCommentLine(line)) continue;
    const indent = lineIndent(line);
    if (indent <= dashIndent) break;
    childIndent ??= indent;
    if (indent !== childIndent) continue;
    const kv = line.match(siblingRe);
    if (kv) return kv[1];
  }
  return null;
}
