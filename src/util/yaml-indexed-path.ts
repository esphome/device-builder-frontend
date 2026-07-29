/**
 * Line → indexed-path walk over a section's body: `findFieldLine`'s
 * inverse, in its own module only for `yaml-sections-core`'s file-size
 * cap. Frames follow the fallback parser's rules, not `findFieldLine`'s
 * descent: the child column comes from `listItemChildIndent` on the
 * section's own line (a flat host falls back to `indent + 2` rather
 * than reading the first child), block scalars and flow collections
 * aren't modelled, and only bare `key:` lines open frames — a quoted or
 * hyphenated container drops its frame, which consumers detect as an
 * index with no named parent.
 */

import {
  BARE_MAPPING_KEY_RE,
  BLOCK_SCALAR_RE,
  isBlankOrCommentLine,
  LIST_ITEM_START_RE,
} from "./yaml-section-lexer.js";
import { _blockScalarBodyEnd } from "./yaml-section-list.js";
import { RE_PAIR_LINE, stripComment } from "./yaml-line-walker.js";
import {
  lineIndent,
  listItemChildIndent,
  type YamlSection,
} from "./yaml-sections-core.js";

/** One enclosing container frame: a bare mapping key or a 0-based list
 *  index, at the indent column that owns it. */
export interface IndexedPathFrame {
  indent: number;
  seg: string | number;
}

/** A visited content line and the container frames enclosing it. */
export interface IndexedPathVisit {
  /** 0-based index of the visited line. */
  lineIdx: number;
  /** The line's own key — bare (`pin:`), valued (`number: 33`), or
   *  dash-inline (`- name: x`) — or null for a keyless line. */
  key: string | null;
  /** True when the line's bare key opens a frame (value-less `key:`). */
  isBare: boolean;
  /** Content column of the line's key (dash-adjusted for inline keys). */
  keyIndent: number;
  /** Live enclosing-frame stack, outermost first, NOT including the
   *  line's own key. Mutated in place as the walk advances — copy what
   *  must outlive the callback. */
  frames: readonly IndexedPathFrame[];
}

/**
 * One forward pass over *section*'s body, firing *visit* for each
 * addressable content line in line order. Return `false` to stop.
 *
 * Lines shallower than the section's child column, blank/comment lines,
 * and block-scalar bodies still maintain frames but are never visited.
 */
export function walkIndexedPaths(
  lines: string[],
  section: YamlSection,
  visit: (v: IndexedPathVisit) => void | false
): void {
  const hostLine = lines[section.fromLine - 1] ?? "";
  const childIndent = listItemChildIndent(hostLine);
  const stack: IndexedPathFrame[] = [];
  // A bare inline first key on the instance dash line (``- valves:``)
  // opens a block the loop below never sees — seed its frame.
  const hostDash = hostLine.match(LIST_ITEM_START_RE);
  const hostRest = hostDash ? hostLine.slice(childIndent) : "";
  const hostInlineKey = hostDash ? hostRest.match(BARE_MAPPING_KEY_RE) : null;
  if (hostInlineKey) stack.push({ indent: childIndent, seg: hostInlineKey[1] });
  // A block scalar opened inline on the dash line hides its body from
  // the loop's opener check — start past it, its body unvisited.
  let walkStart = section.fromLine;
  if (hostDash && !hostInlineKey && BLOCK_SCALAR_RE.test(hostRest)) {
    walkStart = _blockScalarBodyEnd(lines, section.fromLine, childIndent);
  }
  const last = Math.min(section.toLine, lines.length) - 1;
  for (let j = walkStart; j <= last; j++) {
    const line = lines[j];
    if (isBlankOrCommentLine(line)) continue;
    let indent = lineIndent(line);
    let rest = line.slice(indent);
    const dash = line.match(LIST_ITEM_START_RE);
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.indent < indent) break;
      // A dash keeps its same-indent frames: the sibling index it
      // increments, and — in the zero-indent sequence style — the
      // parent key whose column the dashes share.
      if (dash && top.indent === indent) break;
      stack.pop();
    }
    if (dash) {
      const top = stack[stack.length - 1];
      if (top && top.indent === indent && typeof top.seg === "number") {
        top.seg += 1;
      } else {
        stack.push({ indent, seg: 0 });
      }
      const contentCol = listItemChildIndent(line);
      rest = line.slice(contentCol);
      if (!rest.trim()) continue;
      // An inline first key sits at the item's content column.
      indent = contentCol;
    }
    if (lineIndent(line) >= childIndent) {
      const bare = rest.match(BARE_MAPPING_KEY_RE);
      const pair = bare ? null : stripComment(rest).match(RE_PAIR_LINE);
      const stop = visit({
        lineIdx: j,
        key: bare?.[1] ?? pair?.[1] ?? null,
        isBare: bare !== null,
        keyIndent: indent,
        frames: stack,
      });
      if (stop === false) return;
    }
    // A block scalar's body is opaque text: a key-shaped line inside it
    // is not a field, and its content must not misframe the walk.
    if (BLOCK_SCALAR_RE.test(rest)) {
      j = _blockScalarBodyEnd(lines, j + 1, indent) - 1;
      continue;
    }
    const blockKey = rest.match(BARE_MAPPING_KEY_RE);
    if (blockKey) stack.push({ indent, seg: blockKey[1] });
  }
}

/**
 * `findFieldLine`'s inverse: the indexed section-relative path of the
 * key on 1-indexed *line*, list items as 0-based numeric indices, or
 * null (keyless / blank / comment line, block-scalar body, line outside
 * the section or shallower than its child column).
 */
export function indexedPathAtLine(
  yaml: string,
  section: YamlSection,
  line: number
): Array<string | number> | null {
  const lines = yaml.split("\n");
  let path: Array<string | number> | null = null;
  walkIndexedPaths(lines, section, (v) => {
    if (v.lineIdx < line - 1) return;
    if (v.lineIdx === line - 1 && v.key !== null) {
      path = [...v.frames.map((f) => f.seg), v.key];
    }
    return false;
  });
  return path;
}
