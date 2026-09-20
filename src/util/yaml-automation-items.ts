/**
 * Item enumeration and key reading for the top-level automation blocks the
 * fallback parser lists: script, interval and api.actions rows.
 */

import { isBlankOrCommentLine, LIST_ITEM_START_RE } from "./yaml-section-lexer.js";
import { lineIndent } from "./yaml-sections-core.js";

/** A dash line with inline content — the match length is the item's
 *  content column. */
const _DASH_CONTENT_RE = /^\s*-\s+(?=\S)/;

/** The keys the parser reads off an item line; the set is closed, so the
 *  patterns are built once and never from user text. */
export type ItemKey = "id" | "interval" | "action" | "service";

function _keyValueRes(key: ItemKey): { dash: RegExp; sibling: RegExp } {
  // The value's quotes are peeled; the dash-line form ('- id: my_alarm')
  // and the indented sibling form share it.
  const value = `${key}:\\s*["']?([^"'\\s]+)["']?`;
  return {
    dash: new RegExp(`^\\s*-\\s*${value}`),
    sibling: new RegExp(`^\\s+${value}`),
  };
}

const _KEY_VALUE_RES: Record<ItemKey, { dash: RegExp; sibling: RegExp }> = {
  id: _keyValueRes("id"),
  interval: _keyValueRes("interval"),
  action: _keyValueRes("action"),
  service: _keyValueRes("service"),
};

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

export function readKeyOnLine(
  lines: string[],
  fromLine: number,
  key: ItemKey
): string | null {
  const target = lines[fromLine - 1];
  const { dash, sibling: siblingRe } = _KEY_VALUE_RES[key];
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
