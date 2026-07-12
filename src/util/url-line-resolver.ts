/**
 * Resolve a ``?line=N`` URL parameter to a concrete editor
 * highlight + section once the YAML has loaded.
 *
 * Used by the device page when the user arrives via a YAML hit
 * click from the dashboard search — the URL carries only
 * ``?line=N`` (no ``?section=``), and the navigator's highlight
 * + scroll path keys off ``selectedSection``. Without this
 * resolver the editor mounts but never scrolls.
 *
 * Pure functions so the device page's call sites stay thin
 * wrappers that just assign the resolved values; behaviour is
 * unit-testable without spinning up Lit / CodeMirror.
 */

import { formRelativePath } from "./backend-field-errors.js";
import type { YamlPathSegment } from "./yaml-ast.js";
import { pathsForYamlLine } from "./yaml-cursor-paths.js";
import { sectionAtLine, sectionKeyOf } from "./yaml-sections.js";

export interface ResolvedUrlLine {
  /** Section key (e.g. ``"esphome"``, ``"sensor.dht"``) the line falls within. */
  sectionKey: string;
  /** First line of the section *instance* containing the URL line — what a
   *  live caret move would pin as ``selectedFromLine`` (duplicate-key
   *  sections resolve their instance by it). */
  sectionFromLine: number;
  /**
   * Highlight range fed to the YAML editor.
   *
   * Pinned to a *single line* (``fromLine === toLine === line``)
   * rather than the full containing section. The editor scrolls
   * to ``range.fromLine``, so widening to the section's range
   * would land the user on the section header even when their
   * URL pointed deep inside it — and multiple hits within the
   * same section would all jump to the same spot. The user
   * clicked a specific line; land on that line.
   */
  range: { fromLine: number; toLine: number };
}

/** ``ResolvedUrlLine`` plus the focus paths a live caret on that line
 *  would have produced. */
export interface ResolvedUrlLineFocus extends ResolvedUrlLine {
  /** Section-relative form field path; ``[]`` when the line names no field. */
  fieldPath: string[];
  /** Document-absolute indexed key path; ``undefined`` when the AST
   *  couldn't anchor the line. */
  yamlPath?: YamlPathSegment[];
}

/**
 * Resolve *line* (1-indexed) inside *yaml* to its containing
 * top-level section, or ``null`` when:
 *
 * - ``line`` is undefined (no ``?line=`` param);
 * - ``yaml`` is empty (still loading — caller should retry
 *   when the YAML lands);
 * - the line falls outside any parsed section (line points at
 *   leading comments / blank lines before the first key).
 *
 * The caller assigns the returned ``sectionKey`` to its
 * ``selectedSection`` and ``range`` to its ``highlightRange``;
 * combined with ``scrollToHighlight = true``, that drives the
 * editor's scroll-into-view dispatch.
 */
export function resolveSectionForUrlLine(
  yaml: string,
  line: number | undefined
): ResolvedUrlLine | null {
  if (line === undefined) return null;
  // ``line`` came from a URL param via ``Number(raw)`` so it
  // can be ``NaN``, fractional (``?line=7.5``), zero, or
  // negative. CodeMirror's ``doc.line(n)`` (the eventual
  // consumer of ``range.fromLine``) wants a 1-indexed integer
  // and throws on out-of-range; ``sectionAtLine`` likewise
  // expects a positive integer. Reject anything that isn't.
  if (!Number.isInteger(line) || line < 1) return null;
  if (!yaml) return null;
  const match = sectionAtLine(yaml, line);
  if (!match) return null;
  return {
    sectionKey: sectionKeyOf(match),
    sectionFromLine: match.fromLine,
    range: { fromLine: line, toLine: line },
  };
}

/**
 * ``resolveSectionForUrlLine`` plus the deep-focus paths, for the
 * once-per-navigation load path.
 *
 * With *currentSection* set (the URL carried ``?section=`` too), the
 * line must resolve inside that same section or the whole result is
 * ``null`` — focusing a field in a section the URL didn't select
 * would flash an unrelated form.
 */
export function resolveUrlLineFocus(
  yaml: string,
  line: number | undefined,
  currentSection: string | null
): ResolvedUrlLineFocus | null {
  const resolved = resolveSectionForUrlLine(yaml, line);
  if (!resolved) return null;
  if (currentSection !== null && currentSection !== resolved.sectionKey) return null;
  const paths = pathsForYamlLine(yaml, resolved.range.fromLine);
  return {
    ...resolved,
    fieldPath: paths ? formRelativePath(paths.path) : [],
    yamlPath: paths?.indexedPath,
  };
}
