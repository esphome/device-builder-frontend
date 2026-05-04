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
 * Pure function so the device page's call site stays a thin
 * wrapper that just assigns the resolved values; behaviour is
 * unit-testable without spinning up Lit / CodeMirror.
 */

import { sectionAtLine, sectionKeyOf } from "./yaml-sections.js";

export interface ResolvedUrlLine {
  /** Section key (e.g. ``"esphome"``, ``"sensor.dht"``) the line falls within. */
  sectionKey: string;
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

/**
 * Resolve *line* (1-indexed) inside *yaml* to its containing
 * top-level section, or ``null`` when:
 *
 * - ``line`` is undefined (no ``?line=`` param);
 * - ``yaml`` is empty (still loading — caller should retry
 *   when the YAML lands);
 * - ``currentSection`` is already set (user already picked a
 *   section, don't overwrite their selection);
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
  line: number | undefined,
  currentSection: string | null
): ResolvedUrlLine | null {
  if (line === undefined) return null;
  // ``line`` came from a URL param via ``Number(raw)`` so it
  // can be ``NaN``, fractional (``?line=7.5``), zero, or
  // negative. CodeMirror's ``doc.line(n)`` (the eventual
  // consumer of ``range.fromLine``) wants a 1-indexed integer
  // and throws on out-of-range; ``sectionAtLine`` likewise
  // expects a positive integer. Reject anything that isn't.
  if (!Number.isInteger(line) || line < 1) return null;
  if (currentSection !== null) return null;
  if (!yaml) return null;
  const match = sectionAtLine(yaml, line);
  if (!match) return null;
  return {
    sectionKey: sectionKeyOf(match),
    range: { fromLine: line, toLine: line },
  };
}
