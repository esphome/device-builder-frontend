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
import { isIndexSegment } from "./nested-values.js";
import { LIST_SECTIONS } from "./section-entry-overrides.js";
import { indentOf, RE_PAIR_LINE, stripComment } from "./yaml-line-walker.js";
import { splitInlineComment, stripQuotes } from "./yaml-scalar.js";
import {
  _skipBlankAndCommentLines,
  endsBlockAtIndent,
  LIST_ITEM_START_RE,
  TOP_LEVEL_KEY_RE,
} from "./yaml-section-lexer.js";

export interface YamlSection {
  key: string;
  fromLine: number; // 1-indexed (CodeMirror convention)
  toLine: number; // 1-indexed, inclusive
  name?: string; // "name:" value from a YAML list item
  id?: string; // "id:" value from a YAML list item
  platform?: string; // "platform:" value from a YAML list item
  parentKey?: string; // top-level key when this is an expanded list item
  /**
   * For an automation on a nested sub-entity (``aht20_temperature`` under
   * ``sensor: - platform: aht10``), the owning platform component's id, so
   * that component's section can list its sub-entities' automations.
   */
  parentComponentId?: string;
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
   * Component action-list field name (``open_action``) for a
   * ``component_action`` automation row. Kept distinct from
   * ``eventKey`` (a trigger key) so the trigger table and
   * ``_triggerLabel`` don't sweep these in — these have no trigger.
   */
  actionField?: string;
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
    const match = lines[i].match(TOP_LEVEL_KEY_RE);
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
 * If a top-level section contains YAML list items, expand each into
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

  // The section is a list iff its first content line is a dash. Its
  // indent — column 0 (YAML's zero-indented sequence), 2, 4, ... —
  // is the item indent; deeper dashes belong to nested sequences.
  const firstContentIdx = _skipBlankAndCommentLines(lines, keyIdx + 1);
  const firstContentIndent =
    firstContentIdx <= endIdx ? lineIndent(lines[firstContentIdx]) : -1;

  // A list iff the first content line is a dash; then every sibling dash at
  // that indent is an item (shared with the reference scan's level walk).
  const listStarts =
    firstContentIdx <= endIdx && LIST_ITEM_START_RE.test(lines[firstContentIdx])
      ? _dashesAtIndent(lines, firstContentIdx, endIdx, firstContentIndent)
      : [];

  if (listStarts.length === 0) {
    // Single-instance section (e.g. `uart:` configured as a flat
    // dict with `id:`, `tx_pin:` etc. directly under it). Extract a
    // top-level `id:`/`name:` so the navigator can show them as the
    // primary label instead of falling back to the bare key, and a
    // top-level `platform:` so a bare-mapping platform component (the
    // legacy `ota:\n  platform: esphome` form) resolves to its
    // `<key>.<platform>` editor like the `- platform:` list form does.
    let name = "";
    let id = "";
    let platform = "";
    for (let i = keyIdx + 1; i <= endIdx; i++) {
      // Only the block's own direct keys; deeper nested keys aren't
      // the singleton's id/name, and a compact child sequence's
      // `- id:` at the direct-child indent isn't either.
      if (lineIndent(lines[i]) !== firstContentIndent) continue;
      if (LIST_ITEM_START_RE.test(lines[i])) continue;
      name = readInstanceScalar(lines[i], "name") ?? name;
      id = readInstanceScalar(lines[i], "id") ?? id;
      platform = readInstanceScalar(lines[i], "platform") ?? platform;
    }
    return [
      {
        key: section.key,
        fromLine: section.fromLine,
        toLine: section.toLine,
        name: name || undefined,
        id: id || undefined,
        platform: platform || undefined,
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
      if (j !== itemStart && lineIndent(line) !== childIndent) continue;
      name = readInstanceScalar(line, "name") ?? name;
      id = readInstanceScalar(line, "id") ?? id;
      platform = readInstanceScalar(line, "platform") ?? platform;
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
  return lineIndent(dashLine) + ESPHOME_YAML_INDENT.length;
}

/** Leading-space count of *line* (its indentation column). */
export function lineIndent(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

const _INSTANCE_SCALAR_RE = new Map<string, RegExp>();

/**
 * Value of a ``<key>: value`` line (surrounding quotes peeled), or ``null``.
 *
 * Allows an optional leading ``- `` list dash; ``id`` / ``platform`` take a
 * bare token, other keys (``name``) the rest of the line. A trailing inline
 * comment is stripped quote-aware (YAML's whitespace-preceded ``#`` rule):
 * ``name: a#b`` keeps ``a#b``, ``name: "Foo # b"`` keeps ``Foo # b``,
 * ``name: Foo  # bar`` keeps ``Foo``, ``name: # c`` is ``null`` (comment
 * only). Callers gate the line's indent.
 */
export function readInstanceScalar(line: string, key: string): string | null {
  const bareToken = key === "id" || key === "platform";
  let re = _INSTANCE_SCALAR_RE.get(key);
  if (re === undefined) {
    re = bareToken
      ? new RegExp(`^\\s*(?:-\\s+)?${key}:\\s*["']?(\\S+?)["']?(?:\\s+#.*)?\\s*$`)
      : new RegExp(`^\\s*(?:-\\s+)?${key}:\\s*(.*)$`);
    _INSTANCE_SCALAR_RE.set(key, re);
  }
  const m = line.match(re);
  if (!m) return null;
  if (bareToken) return m[1];
  const { value } = splitInlineComment(m[1]);
  const trimmed = value.trim();
  // Comment-only value (``name: # c``): the leading ``#`` isn't whitespace-
  // preceded, so splitInlineComment keeps it. Quoted ``"#x"`` starts with the quote.
  if (trimmed.startsWith("#")) return null;
  return stripQuotes(trimmed).trim() || null;
}

/**
 * 1-indexed YAML line of the instance-relative field *relPath* within
 * *section*, or ``null`` so callers fall back to the whole-section range.
 * Descends both mapping keys (``["pin","number"]`` → the nested
 * ``number:`` line) and list indices (``["areas","0","id"]`` → the ``id:``
 * line of the first ``areas`` item) — the latter is how list-of-maps form
 * fields (areas, globals) key their children.
 */
export function findFieldLine(
  yaml: string,
  section: YamlSection,
  relPath: string[]
): number | null {
  // Accept an optional leading section key (some callers pass it, e.g.
  // ``["globals", …]``) and strip it so the path is section-relative.
  if (relPath[0] === section.key) relPath = relPath.slice(1);
  if (relPath.length === 0) return null;
  const lines = yaml.split("\n");

  // Descend *path* within [lo, hi]; keys / dashes for this level sit at
  // *baseIndent*.
  const descend = (
    lo: number,
    hi: number,
    baseIndent: number,
    path: string[]
  ): number | null => {
    const seg = path[0];
    const rest = path.slice(1);
    // A numeric segment is a list index only when this level actually is a
    // list (first content line a dash); otherwise it's a literal numeric
    // mapping key (a ``0:`` substitution) and falls through to the key match.
    // A compact block-sequence value deeper in a mapping must not flip this.
    if (isIndexSegment(seg) && _levelIsList(lines, lo, hi, baseIndent)) {
      const dashes = _dashesAtIndent(lines, lo, hi, baseIndent);
      const itemLo = dashes[Number(seg)];
      if (itemLo === undefined) return null;
      if (rest.length === 0) return itemLo + 1;
      const itemHi = Number(seg) + 1 < dashes.length ? dashes[Number(seg) + 1] - 1 : hi;
      return descend(itemLo, itemHi, listItemChildIndent(lines[itemLo]), rest);
    }
    for (let i = lo; i <= hi; i++) {
      const s = stripComment(lines[i]);
      if (!s.trim() || keyIndentOf(s) !== baseIndent) continue;
      const m = s.match(RE_PAIR_LINE);
      if (!m || m[1] !== seg) continue;
      if (rest.length === 0) return i + 1;
      const blockHi = _blockEndAtIndent(lines, i + 1, hi, baseIndent);
      const childIndent = firstContentIndentIn(lines, i + 1, blockHi);
      return childIndent === null ? null : descend(i + 1, blockHi, childIndent, rest);
    }
    return null;
  };

  const body = _sectionScanStart(lines, section);
  return body === null ? null : descend(body.lo, body.hi, body.baseIndent, relPath);
}

/** Indent at which a line's key sits: a dash item's inline key (``- name: x``)
 *  is at the content column after ``- ``, not the dash column. */
function keyIndentOf(line: string): number {
  return LIST_ITEM_START_RE.test(line) ? listItemChildIndent(line) : indentOf(line);
}

/** Raw indent column of the first non-blank line in [lo, hi], or null. */
function firstContentIndentIn(lines: string[], lo: number, hi: number): number | null {
  for (let i = lo; i <= hi; i++) {
    const s = stripComment(lines[i]);
    if (s.trim()) return indentOf(s);
  }
  return null;
}

/** Line indices of the list-item dashes sitting at exactly *indent* in [lo, hi]. */
function _dashesAtIndent(
  lines: string[],
  lo: number,
  hi: number,
  indent: number
): number[] {
  const dashes: number[] = [];
  for (let i = lo; i <= hi; i++) {
    const s = stripComment(lines[i]);
    if (s.trim() && indentOf(s) === indent && LIST_ITEM_START_RE.test(s)) dashes.push(i);
  }
  return dashes;
}

/** Last line of the block a key at *baseIndent* opens: the line before the
 *  next sibling at or above *baseIndent*. A same-indent compact block-sequence
 *  value (``key:\n- a``) and comments don't end it (see {@link endsBlockAtIndent}). */
function _blockEndAtIndent(
  lines: string[],
  afterLine: number,
  hi: number,
  baseIndent: number
): number {
  for (let j = afterLine; j <= hi; j++) {
    if (endsBlockAtIndent(lines[j], baseIndent)) return j - 1;
  }
  return hi;
}

/** Where to begin scanning *section*'s body: a list-item section starts at its
 *  header (inline key at the item's child indent); a flat section opens below
 *  its key line. Null when the section range is empty / out of bounds. */
function _sectionScanStart(
  lines: string[],
  section: YamlSection
): { lo: number; hi: number; baseIndent: number } | null {
  const start = section.fromLine - 1;
  const hi = Math.min(section.toLine - 1, lines.length - 1);
  if (start < 0 || start >= lines.length) return null;
  if (LIST_ITEM_START_RE.test(lines[start])) {
    return { lo: start, hi, baseIndent: listItemChildIndent(lines[start]) };
  }
  const baseIndent = firstContentIndentIn(lines, start + 1, hi);
  return baseIndent === null ? null : { lo: start + 1, hi, baseIndent };
}

/** Whether [lo, hi] is a YAML list at *levelIndent*: its *first* content line
 *  is a dash there. Keying off the first line, not "any dash at this indent",
 *  is what tells a list apart from a mapping that merely holds a compact
 *  block-sequence value (``channels:\n- id: …``) deeper down. */
function _levelIsList(
  lines: string[],
  lo: number,
  hi: number,
  levelIndent: number
): boolean {
  for (let i = lo; i <= hi; i++) {
    const s = stripComment(lines[i]);
    if (!s.trim()) continue;
    return indentOf(s) === levelIndent && LIST_ITEM_START_RE.test(s);
  }
  return false;
}

/** Item sub-regions of [lo, hi] whose own keys sit at *levelIndent*: a list
 *  yields one region per dash (keys at the dash's child indent); otherwise the
 *  region is a single mapping (keys at *levelIndent*). */
function _itemRegions(
  lines: string[],
  lo: number,
  hi: number,
  levelIndent: number
): Array<{ lo: number; hi: number; keyIndent: number }> {
  if (!_levelIsList(lines, lo, hi, levelIndent))
    return [{ lo, hi, keyIndent: levelIndent }];
  const dashes = _dashesAtIndent(lines, lo, hi, levelIndent);
  return dashes.map((d, k) => ({
    lo: d,
    hi: k + 1 < dashes.length ? dashes[k + 1] - 1 : hi,
    keyIndent: listItemChildIndent(lines[d]),
  }));
}

/**
 * Collect ``{id, name}`` for every instance at the key-path *path* within
 * *section* (``["channels", "id"]`` → each usb_uart channel's id).
 *
 * Each segment is a mapping key; a segment whose value is a list expands over
 * every item, so a nested-list provider (usb_uart channels, tca9548a channels)
 * yields one entry per configured instance. The final segment is read as a
 * scalar, its sibling ``name`` (if any) becoming the label. Takes pre-split
 * *lines* so a caller scanning many sections / paths splits the YAML once.
 */
export function collectIdsAtPath(
  lines: string[],
  section: YamlSection,
  path: string[]
): Array<{ id: string; name: string }> {
  if (path.length === 0) return [];
  const out: Array<{ id: string; name: string }> = [];

  const walk = (lo: number, hi: number, levelIndent: number, segs: string[]): void => {
    for (const item of _itemRegions(lines, lo, hi, levelIndent)) {
      if (segs.length === 1) {
        let id = "";
        let name = "";
        for (let i = item.lo; i <= item.hi; i++) {
          if (keyIndentOf(lines[i]) !== item.keyIndent) continue;
          id = readInstanceScalar(lines[i], segs[0]) ?? id;
          name = readInstanceScalar(lines[i], "name") ?? name;
        }
        if (id) out.push({ id, name });
        continue;
      }
      for (let i = item.lo; i <= item.hi; i++) {
        if (keyIndentOf(lines[i]) !== item.keyIndent) continue;
        const m = stripComment(lines[i]).match(RE_PAIR_LINE);
        if (!m || m[1] !== segs[0]) continue;
        const blockHi = _blockEndAtIndent(lines, i + 1, item.hi, item.keyIndent);
        const childIndent = firstContentIndentIn(lines, i + 1, blockHi);
        if (childIndent !== null) walk(i + 1, blockHi, childIndent, segs.slice(1));
        break;
      }
    }
  };

  const body = _sectionScanStart(lines, section);
  if (body !== null) walk(body.lo, body.hi, body.baseIndent, path);
  return out;
}
