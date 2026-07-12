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

/** The key path plus its indexed (AST-only) sibling, as carried by the
 *  editor's ``yaml-cursor-line`` event. */
export interface YamlLinePaths {
  path: string[];
  /** ``undefined`` on lines only the indent walkers can anchor. */
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
  // Runs once per navigation; a device YAML parses in single-digit ms.
  // A null return (budget exhausted) still leaves a usable partial tree.
  ensureSyntaxTree(state, state.doc.length, 1000);
  const pos = state.doc.line(line).to;
  const indexedPath = getKeyPathWithListIndices(state, pos);
  return {
    path: cursorKeyPathAt(state, pos),
    indexedPath: indexedPath.length ? indexedPath : undefined,
  };
}
