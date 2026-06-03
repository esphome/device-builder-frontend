/**
 * Pure top-level-section parsing primitives, split out of
 * `yaml-sections.ts` so `yaml-automations.ts` can reuse them without a
 * circular import: `yaml-sections.ts` imports the synchronous automation
 * parser from `yaml-automations.ts`, so the shared section helpers must
 * live in a module neither of those depends on. This is a leaf module —
 * it imports nothing from `yaml-sections.ts` / `yaml-automations.ts`.
 *
 * `yaml-sections.ts` re-exports everything here, so existing call sites
 * importing these from `./yaml-sections.js` are unaffected.
 */

import { ESPHOME_YAML_INDENT } from "./esphome-yaml-lang.js";
import { LIST_SECTIONS } from "./section-entry-overrides.js";

export interface YamlSection {
  key: string;
  fromLine: number; // 1-indexed (CodeMirror convention)
  toLine: number; // 1-indexed, inclusive
  name?: string; // "name:" value from a YAML list item
  id?: string; // "id:" value from a YAML list item
  platform?: string; // "platform:" value from a YAML list item
  parentKey?: string; // top-level key when this is an expanded list item
  /**
   * Human-readable label for the navigator. Set when ``key`` is a
   * stable machine identifier (e.g. an automation's
   * ``automation:component_on:<id>:on_press``) that wouldn't render
   * well in the UI. Navigator consumers prefer ``displayLabel`` when
   * present and fall back to ``key`` otherwise.
   */
  displayLabel?: string;
  /**
   * Bare trigger event key (``on_press``, ``on_turn_on``) for
   * automation entries. The navigator combines this with
   * ``parentKey`` to look up the trigger's pretty name in the
   * catalog (``binary_sensor.on_press`` → "Pressed").
   */
  eventKey?: string;
  /**
   * Free-form metadata payload — currently used to surface the
   * ``interval: 60s`` time on an interval entry so the navigator
   * can show "Every 60s" instead of "interval #1". Optional for
   * everything else.
   */
  meta?: Record<string, string>;
}

/**
 * Trim predicate: true for blank lines and unindented (top-level)
 * comments that act as banners between sections. INDENTED comments
 * are treated as content of the surrounding section — a config like
 *
 *     wifi:
 *       ssid: x
 *       # password set via secrets
 *
 * has the trailing comment as part of `wifi:`, so dropping it from
 * the section's range would mis-locate the user-visible content.
 * Only top-level `#` lines decorate the next section.
 */
function _isBlankOrBannerComment(line: string): boolean {
  if (line.trim() === "") return true;
  // A banner comment starts at column 0 — any leading whitespace
  // means it belongs to the surrounding indented block.
  return line.startsWith("#");
}

/**
 * Single-entry memo for `parseYamlTopLevelSections`. The hot path
 * is the YAML pane's cursor channel: the page's
 * `_onYamlCursorLine` handler calls `sectionAtLine` on every line
 * transition, which in turn re-parses the document. Hold-arrow
 * scrolling and find-jumps fire that many times in a row, and the
 * page hands us the same `_yaml` string instance until the user
 * types, so this collapses to O(1) on the typical render cycle.
 *
 * The navigator also calls `parseYamlTopLevelSections` directly
 * (twice per render — top-level sections + automation siblings),
 * so the same memo also covers the navigator's render hot path.
 *
 * Same shape as `createScanMemo` in `config-entry-yaml-scan.ts`,
 * but inlined here because the closure only needs to cache one
 * function's input/output and a separate factory would be
 * over-engineered for a single-keyed memo.
 */
let _topLevelSectionsKey: string | undefined;
let _topLevelSectionsValue: YamlSection[] | undefined;

/**
 * Extracts top-level YAML keys and their line ranges.
 * Top-level keys have no leading whitespace (e.g. `esphome:`, `wifi:`).
 * Sections containing YAML list items (e.g. `light:\n  - platform: binary`)
 * are expanded so each list item becomes its own section with name/platform metadata.
 */
export function parseYamlTopLevelSections(yaml: string): YamlSection[] {
  if (_topLevelSectionsKey === yaml && _topLevelSectionsValue) {
    return _topLevelSectionsValue;
  }
  const lines = yaml.split("\n");
  const rawSections: Array<{ key: string; fromLine: number; toLine: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([a-zA-Z_][a-zA-Z0-9_]*):/);
    if (match) {
      if (rawSections.length > 0) {
        // The previous section content ends one line before the new
        // top-level key. Walk backward over trailing blank /
        // comment-only lines: those typically decorate the upcoming
        // section ("## Substitutions ##" sitting above
        // ``substitutions:``) rather than belonging to the one
        // ending. Without the trim, hovering ``runtime_stats`` in the
        // navigator highlights the comment block that visually
        // documents ``substitutions``.
        const prev = rawSections[rawSections.length - 1];
        const prevStart = prev.fromLine - 1; // 0-indexed
        let endIdx = i - 1;
        while (endIdx > prevStart && _isBlankOrBannerComment(lines[endIdx])) {
          endIdx--;
        }
        prev.toLine = endIdx + 1;
      }
      rawSections.push({
        key: match[1],
        fromLine: i + 1, // convert 0-indexed array to 1-indexed CM line
        toLine: lines.length,
      });
    }
  }

  // Trim trailing blank / comment-only lines from the final section
  // for the same reason as above — a comment block at the very end
  // of the file (or right before EOF whitespace) shouldn't extend
  // the last section's hover-highlight range.
  if (rawSections.length > 0) {
    const last = rawSections[rawSections.length - 1];
    const lastStart = last.fromLine - 1; // 0-indexed
    let endIdx = lines.length - 1;
    // Drop the conventional trailing newline-empty-string before
    // the trim loop so we don't double-count it.
    if (endIdx >= 0 && lines[endIdx] === "") endIdx--;
    while (endIdx > lastStart && _isBlankOrBannerComment(lines[endIdx])) {
      endIdx--;
    }
    last.toLine = endIdx + 1;
  }

  // Expand list items within each section
  const sections: YamlSection[] = [];
  for (const raw of rawSections) {
    sections.push(..._expandListItems(lines, raw));
  }

  _topLevelSectionsKey = yaml;
  _topLevelSectionsValue = sections;
  return sections;
}

/**
 * Test-only: clear the `parseYamlTopLevelSections` memo so cached
 * results from a prior test case don't leak into the next. Mirrors
 * `_clearScanMemos` in `config-entry-yaml-scan.ts`.
 */
export function _clearYamlSectionsMemo(): void {
  _topLevelSectionsKey = undefined;
  _topLevelSectionsValue = undefined;
}

/**
 * If a top-level section contains YAML list items (`  - `), expand each into
 * its own YamlSection with name, platform, and parentKey metadata.
 * Otherwise return the section as-is.
 */
function _expandListItems(
  lines: string[],
  section: { key: string; fromLine: number; toLine: number }
): YamlSection[] {
  // LIST_SECTIONS members keep their list items hidden from the
  // navigator — the user navigates to the whole block (edited as a
  // repeatable list), not the individual entries (e.g. globals).
  if (LIST_SECTIONS.has(section.key)) {
    return [
      {
        key: section.key,
        fromLine: section.fromLine,
        toLine: section.toLine,
      },
    ];
  }

  const keyIdx = section.fromLine - 1; // 0-indexed line of the top-level key
  const endIdx = section.toLine - 1; // 0-indexed last line (inclusive)

  // Find list item starts (`  - ` or `  -\n`)
  const listStarts: number[] = [];
  for (let i = keyIdx + 1; i <= endIdx; i++) {
    if (/^  -\s/.test(lines[i]) || /^  -$/.test(lines[i])) {
      listStarts.push(i);
    }
  }

  if (listStarts.length === 0) {
    // Single-instance section (e.g. `uart:` configured as a flat
    // dict with `id:`, `tx_pin:` etc. directly under it). Extract a
    // top-level `id:`/`name:` so the navigator can show them as the
    // primary label instead of falling back to the bare key.
    let name = "";
    let id = "";
    for (let i = keyIdx + 1; i <= endIdx; i++) {
      const nameMatch = lines[i].match(/^\s{2}name:\s*["']?(.+?)["']?\s*$/);
      if (nameMatch) name = nameMatch[1];
      const idMatch = lines[i].match(/^\s{2}id:\s*["']?(\S+?)["']?\s*$/);
      if (idMatch) id = idMatch[1];
    }
    return [
      {
        key: section.key,
        fromLine: section.fromLine,
        toLine: section.toLine,
        name: name || undefined,
        id: id || undefined,
      },
    ];
  }

  const items: YamlSection[] = [];
  for (let idx = 0; idx < listStarts.length; idx++) {
    const itemStart = listStarts[idx];
    const itemEnd = idx + 1 < listStarts.length ? listStarts[idx + 1] - 1 : endIdx;

    let name = "";
    let id = "";
    let platform = "";
    // Only the list item's own top-level keys count: the dash line's
    // inline key, plus continuation keys at exactly the direct-child
    // indent. Deeper lines belong to nested sub-mappings (a sensor
    // platform's temperature:/humidity: blocks, the debug component's
    // per-metric sensors) whose name:/id: must not override the item's.
    const childIndent = listItemChildIndent(lines[itemStart]);
    for (let j = itemStart; j <= itemEnd; j++) {
      const line = lines[j];
      if (j !== itemStart) {
        const indent = line.match(/^ */)?.[0].length ?? 0;
        if (indent !== childIndent) continue;
      }
      const nameMatch = line.match(/^\s+(?:-\s+)?name:\s*["']?(.+?)["']?\s*$/);
      if (nameMatch) name = nameMatch[1];
      const idMatch = line.match(/^\s+(?:-\s+)?id:\s*["']?(\S+?)["']?\s*$/);
      if (idMatch) id = idMatch[1];
      const platformMatch = line.match(/^\s+(?:-\s+)?platform:\s*["']?(\S+?)["']?\s*$/);
      if (platformMatch) platform = platformMatch[1];
    }

    items.push({
      key: section.key,
      fromLine: itemStart + 1, // 1-indexed
      toLine: itemEnd + 1, // 1-indexed
      name: name || undefined,
      id: id || undefined,
      platform: platform || undefined,
      parentKey: section.key,
    });
  }

  return items;
}

/** Smallest-span section in *sections* whose ``[fromLine, toLine]``
 *  range covers *line* (1-indexed), or ``null`` when *line* falls in
 *  no section. */
export function smallestContainingSection(
  sections: YamlSection[],
  line: number
): YamlSection | null {
  let best: YamlSection | null = null;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const s of sections) {
    if (line < s.fromLine || line > s.toLine) continue;
    const span = s.toLine - s.fromLine;
    if (span < bestSpan) {
      best = s;
      bestSpan = span;
    }
  }
  return best;
}

/**
 * Addressable id for `match`, mirroring the backend so the handle
 * round-trips through ``automations/upsert``: a list item → its ``id:`` or
 * positional ``<domain>_<idx>``; a flat singleton (``sun:``, ``parentKey``
 * unset) → its ``id:`` or the domain.
 */
export function instanceComponentId(sections: YamlSection[], match: YamlSection): string {
  const domain = match.parentKey;
  if (domain === undefined) return match.id ?? match.key;
  if (match.id) return match.id;
  // Count by ``fromLine`` (not ``indexOf``): allocation-free and doesn't
  // depend on ``match`` being the array's own object reference.
  let idx = 0;
  for (const s of sections) {
    if (s.parentKey === domain && s.fromLine < match.fromLine) idx++;
  }
  return `${domain}_${idx}`;
}

/**
 * Column where a list item's direct child keys sit — the first key after
 * the ``- `` marker on *dashLine*. Derived from the line rather than
 * assuming a fixed step: configs may put any number of spaces after the
 * dash (``-   platform:`` → children align past ``dash + 2``), and a
 * fixed ``+2`` would miss continuation ``id:`` / ``name:`` keys. Falls
 * back to one indent past the dash when the dash carries no inline key.
 */
export function listItemChildIndent(dashLine: string): number {
  const inline = dashLine.match(/^\s*-\s+(?=\S)/)?.[0].length;
  if (inline !== undefined) return inline;
  const dashIndent = dashLine.match(/^ */)?.[0].length ?? 0;
  return dashIndent + ESPHOME_YAML_INDENT.length;
}
