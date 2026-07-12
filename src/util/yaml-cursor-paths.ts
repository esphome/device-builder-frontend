/**
 * Key-path derivation for a caret position, shared between the live
 * editor's cursor listener and the URL deep-link load path.
 *
 * The fallback chain matters: the AST can't anchor an empty-value
 * ``key:`` (Lezer leaves the Pair open) and yields nothing on a blank
 * line, so the indent walkers cover those — except inside a block
 * scalar, where a ``key:``-looking content line is literal text and
 * only the AST can tell.
 */

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { esphomeYaml } from "./esphome-yaml-lang.js";
import {
  getKeyPath,
  getKeyPathWithListIndices,
  isInsideBlockScalar,
  type YamlPathSegment,
} from "./yaml-ast.js";
import {
  blankLineContext,
  fieldPathByIndent,
  keyPathByIndent,
} from "./yaml-line-walker.js";

/** Document-absolute key path at *pos*: indent walkers first (they
 *  anchor empty-value pairs and blank lines the AST can't), then the
 *  AST. ``[]`` when nothing anchors. */
export function cursorKeyPathAt(state: EditorState, pos: number): string[] {
  const line = state.doc.lineAt(pos);
  let path = fieldPathByIndent(state.doc, line.number - 1);
  if (path && isInsideBlockScalar(state, pos)) path = null;
  if (!path) {
    path = getKeyPath(state, pos);
    if (path.length === 0) {
      const blank = blankLineContext(state.doc, pos);
      if (blank) path = keyPathByIndent(state.doc, blank.lineIdx, blank.indent, true);
    }
  }
  return path;
}

/** ``getKeyPathWithListIndices`` under the ``yaml-cursor-line`` event's
 *  convention: ``undefined`` (omitted) on lines only the indent walkers
 *  can anchor. */
export function indexedKeyPathAt(
  state: EditorState,
  pos: number
): YamlPathSegment[] | undefined {
  const indexed = getKeyPathWithListIndices(state, pos);
  return indexed.length ? indexed : undefined;
}

/** The key path plus its indexed (AST-only) sibling, as carried by the
 *  editor's ``yaml-cursor-line`` event. */
export interface YamlLinePaths {
  path: string[];
  indexedPath?: YamlPathSegment[];
}

/**
 * Derive the paths a caret at the end of *line* (1-indexed) would
 * report, from a raw YAML string — for deep-link arrivals where no
 * editor view exists yet. ``null`` when the line is out of range.
 */
export function pathsForYamlLine(yaml: string, line: number): YamlLinePaths | null {
  const state = EditorState.create({ doc: yaml, extensions: [esphomeYaml()] });
  if (line < 1 || line > state.doc.lines) return null;
  const pos = state.doc.line(line).to;
  // Runs once per navigation; parsing to the target line is single-digit
  // ms, so the budget only bites on pathological files — where a partial
  // tree fails soft (the indent walkers still anchor the key path). The
  // path walks only read ancestors of ``pos``; nothing past it is needed.
  ensureSyntaxTree(state, pos, 200);
  return {
    path: cursorKeyPathAt(state, pos),
    indexedPath: indexedKeyPathAt(state, pos),
  };
}
