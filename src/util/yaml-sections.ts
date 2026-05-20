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

export interface CategorizedSections {
  core: YamlSection[];
  components: YamlSection[];
  automations: YamlSection[];
}

// ESPHome system/platform keys → Core configuration. This list MUST
// stay in sync with `CORE_CATEGORIES` in `api/types.ts` and the
// backend's `category: "core"` (defined in
// `script/sync_components.py` → `_CATEGORY_OVERRIDES`) so the
// navigator's "Core" group lists exactly the components the
// "Add core configuration" dialog offers.
//
// Two umbrella YAML keys (`ota`, `update`) appear here without
// matching catalog entries — those domains only have platform
// variants (`ota.esphome`, `update.http_request`, …) in the
// catalog, but the top-level YAML block they sit in is still
// firmly "core" and the navigator needs to categorize it correctly.
//
// `time` is NOT here — most devices get the time via the API
// connection to Home Assistant automatically, so an explicit `time:`
// block is the exception, not the rule. It's a regular platform
// component and lives under "Components" in the navigator.
export const CORE_KEYS = new Set([
  // Target platforms
  "esp32", "esp8266", "rp2040", "bk72xx", "rtl87xx", "ln882x", "nrf52", "host",
  // ESPHome infrastructure
  "esphome", "logger", "api", "ota", "wifi", "ethernet", "mqtt", "mdns",
  "network", "web_server", "captive_portal", "improv_serial",
  "safe_mode", "debug", "preferences", "update",
  // Device-wide config keys (not strictly components — no C++
  // implementation — but they share the top-level YAML namespace
  // alongside real components).
  "external_components", "packages", "substitutions", "dashboard_import",
  // `globals:` is technically a list of typed variables, but in
  // practice it acts as device-wide config metadata (variable
  // declarations, similar to substitutions) — we want it living next
  // to the other config keys, not buried under automations.
  "globals",
]);

// Automation/logic keys → Automations
// In ESPHome, automations are inline on_* handlers within components.
// `script` and `interval` are the standalone automation-adjacent
// top-level keys.
const AUTOMATION_KEYS = new Set(["script", "interval"]);

// Sections that contain list items but should still be navigated to
// as a single unit — clicking them takes you to the whole block, not
// to individual entries inside. Keeps the navigator from listing one
// nav item per global variable.
const NON_EXPANDABLE_KEYS = new Set(["globals"]);

export function categorizeSections(sections: YamlSection[]): CategorizedSections {
  const core: YamlSection[] = [];
  const components: YamlSection[] = [];
  const automations: YamlSection[] = [];

  for (const section of sections) {
    if (CORE_KEYS.has(section.key)) {
      core.push(section);
    } else if (AUTOMATION_KEYS.has(section.key)) {
      automations.push(section);
    } else {
      components.push(section);
    }
  }

  return { core, components, automations };
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
  section: { key: string; fromLine: number; toLine: number },
): YamlSection[] {
  // Sections marked non-expandable keep their list items hidden from
  // the navigator — the user navigates to the whole block, not the
  // individual entries (e.g. globals).
  if (NON_EXPANDABLE_KEYS.has(section.key)) {
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
    const itemEnd =
      idx + 1 < listStarts.length ? listStarts[idx + 1] - 1 : endIdx;

    let name = "";
    let id = "";
    let platform = "";
    for (let j = itemStart; j <= itemEnd; j++) {
      const nameMatch = lines[j].match(/^\s+(?:-\s+)?name:\s*["']?(.+?)["']?\s*$/);
      if (nameMatch) name = nameMatch[1];
      const idMatch = lines[j].match(/^\s+(?:-\s+)?id:\s*["']?(\S+?)["']?\s*$/);
      if (idMatch) id = idMatch[1];
      const platformMatch = lines[j].match(
        /^\s+(?:-\s+)?platform:\s*["']?(\S+?)["']?\s*$/,
      );
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

/**
 * Synchronous fallback parser for automation sections. The navigator
 * needs to paint instantly on every keystroke, so we can't wait for
 * the backend's ``automations/parse`` round-trip; this regex-based
 * pass detects:
 *
 * - Inline ``on_*:`` handlers nested inside component instances
 *   (``component_on`` automations).
 * - Device-level ``on_*:`` handlers directly under ``esphome:``
 *   (``device_on`` automations).
 * - List items under top-level ``script:`` and ``interval:`` blocks
 *   (``script`` and ``interval`` automations).
 *
 * Emits stable machine-readable keys
 * (``automation:component_on:<id>:on_press`` etc.) plus a separate
 * ``displayLabel`` for the navigator UI. Section routing reads
 * ``key`` (stable identifier the page can match against a
 * ``ParsedAutomation.location``); the navigator displays
 * ``displayLabel``.
 *
 * The backend's ``automations/parse`` is the canonical source — this
 * fallback only sees what the regex catches, but it's load-bearing
 * for keystroke-time UI responsiveness.
 */
export function parseYamlAutomations(yaml: string): YamlSection[] {
  const lines = yaml.split("\n");
  const automations: YamlSection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s+)(on_[a-zA-Z_]+):/);
    if (!match) continue;

    const indent = match[1].length;
    const eventName = match[2];
    const fromLine = i + 1; // 1-indexed CM line
    const toLine = _findBlockEnd(lines, i, indent);

    // Walk backwards to identify the enclosing block (esphome:
    // device-level, or a configured-component instance with its id).
    const ancestry = _walkAncestry(lines, i, indent);

    if (ancestry.parentKey === "esphome") {
      automations.push({
        key: `automation:device_on:${eventName}`,
        // ``displayLabel`` is the legacy "Esphome → on_boot" label;
        // the navigator now prefers catalog-resolved labels but
        // keeps ``displayLabel`` as a graceful fallback for
        // pre-catalog renders.
        displayLabel: `esphome → ${eventName}`,
        fromLine,
        toLine,
        parentKey: "esphome",
        eventKey: eventName,
      });
    } else if (ancestry.componentId) {
      const labelHead = ancestry.parentName || ancestry.componentId;
      automations.push({
        key: `automation:component_on:${ancestry.componentId}:${eventName}`,
        displayLabel: `${labelHead} → ${eventName}`,
        fromLine,
        toLine,
        id: ancestry.componentId,
        name: ancestry.parentName ?? undefined,
        parentKey: ancestry.parentKey ?? undefined,
        eventKey: eventName,
      });
    } else {
      // No clear ancestry — keep the event as the bare display
      // label and emit a non-namespaced key so it doesn't collide
      // with a properly-resolved automation later.
      automations.push({
        key: `automation:unscoped:${eventName}:${fromLine}`,
        displayLabel: eventName,
        fromLine,
        toLine,
        eventKey: eventName,
      });
    }
  }

  // Top-level ``script:`` / ``interval:`` list items. These don't
  // carry an ``on_*:`` key — the block kind is implied by the
  // location's discriminator.
  for (const top of ["script", "interval"] as const) {
    const block = _findTopLevelBlock(lines, top);
    if (!block) continue;
    const items = _enumerateListItems(lines, block.fromLine, block.toLine);
    items.forEach((item, idx) => {
      const itemId =
        top === "script" ? _readKeyOnLine(lines, item.fromLine, "id") : null;
      const key =
        top === "script" && itemId
          ? `automation:script:${itemId}`
          : `automation:interval:${idx}`;
      const display =
        top === "script" && itemId ? `script: ${itemId}` : `interval #${idx + 1}`;
      const meta: Record<string, string> = {};
      if (top === "interval") {
        // ``interval: 60s`` lives directly on the list item — pull
        // it so the navigator can render "Every 60s" instead of
        // a generic "interval #N". Optional; we fall back to the
        // index when the field is missing or unparseable.
        const every = _readKeyOnLine(lines, item.fromLine, "interval");
        if (every) meta.every = every;
      }
      automations.push({
        key,
        displayLabel: display,
        fromLine: item.fromLine,
        toLine: item.toLine,
        id: top === "script" && itemId ? itemId : undefined,
        parentKey: top,
        meta: Object.keys(meta).length > 0 ? meta : undefined,
      });
    });
  }

  // ``api.actions:`` list items — Home Assistant-callable actions
  // nested under the top-level ``api:`` block. Same callable shape
  // as ``script:`` (named entry, no trigger key) but one level
  // deeper in the YAML tree. Each item's ``action:`` (or legacy
  // ``service:``) value is the stable discriminator.
  const apiBlock = _findTopLevelBlock(lines, "api");
  if (apiBlock) {
    const actionsBlock = _findChildBlock(
      lines,
      apiBlock.fromLine,
      apiBlock.toLine,
      "actions",
    );
    if (actionsBlock) {
      const items = _enumerateListItems(
        lines,
        actionsBlock.fromLine,
        actionsBlock.toLine,
      );
      for (const item of items) {
        const actionName =
          _readKeyOnLine(lines, item.fromLine, "action") ??
          _readKeyOnLine(lines, item.fromLine, "service");
        if (!actionName) continue;
        automations.push({
          key: `automation:api_action:${actionName}`,
          displayLabel: `API: ${actionName}`,
          fromLine: item.fromLine,
          toLine: item.toLine,
          id: actionName,
          parentKey: "api",
        });
      }
    }
  }

  return automations;
}

/** First non-empty line at indent ≤ ``indent`` after ``startIdx``,
 *  or end-of-file. */
function _findBlockEnd(
  lines: string[],
  startIdx: number,
  indent: number,
): number {
  for (let j = startIdx + 1; j < lines.length; j++) {
    if (lines[j].trim() === "") continue;
    const lineIndent = (lines[j].match(/^(\s*)/) ?? ["", ""])[1].length;
    if (lineIndent <= indent) return j;
  }
  return lines.length;
}

interface Ancestry {
  parentKey: string | null;
  parentName: string | null;
  componentId: string | null;
}

/**
 * Walk backwards from an ``on_*:`` line to identify the enclosing
 * block. Returns:
 *
 * - ``parentKey`` — the nearest top-level key
 *   (``esphome``, ``binary_sensor``, …) discovered by scanning to
 *   a column-0 anchor.
 * - ``parentName`` — the configured component's ``name:`` if found,
 *   used as a display label.
 * - ``componentId`` — the configured component's ``id:`` if found,
 *   used as the stable identifier.
 */
function _walkAncestry(
  lines: string[],
  startIdx: number,
  childIndent: number,
): Ancestry {
  let parentKey: string | null = null;
  let parentName: string | null = null;
  let componentId: string | null = null;
  // True once we've crossed our list item's leading ``-`` (at indent
  // < childIndent). Beyond that boundary we keep scanning *only* to
  // find the top-level key; we no longer harvest id / name (those
  // would belong to a previous sibling, not us).
  let crossedItemBoundary = false;
  for (let j = startIdx - 1; j >= 0; j--) {
    const line = lines[j];
    if (line.trim() === "") continue;
    const topLevel = line.match(/^([a-zA-Z_][\w]*)\s*:/);
    if (topLevel) {
      parentKey = topLevel[1];
      break;
    }
    const lineIndent = (line.match(/^(\s*)/) ?? ["", ""])[1].length;
    // A list-item dash at an indent shallower than our handler is
    // our own item's leading row (we're somewhere inside it). Cross
    // it but keep walking — the top-level key still sits above us.
    if (lineIndent < childIndent && /^\s*-\s/.test(line)) {
      crossedItemBoundary = true;
      continue;
    }
    // Deeper lines (nested blocks under our handler's siblings)
    // can't contribute id / name for our automation.
    if (lineIndent > childIndent) continue;
    if (crossedItemBoundary) continue;
    const idMatch = line.match(
      /^\s+(?:-\s+)?id:\s*["']?([^"'\s]+)["']?\s*$/,
    );
    if (idMatch && !componentId) componentId = idMatch[1];
    const nameMatch = line.match(
      /^\s+(?:-\s+)?name:\s*["']?(.+?)["']?\s*$/,
    );
    if (nameMatch && !parentName) parentName = nameMatch[1];
  }
  return { parentKey, parentName, componentId };
}

/** Top-level key block (``script:`` / ``interval:``) with its
 *  inclusive 1-indexed line range, or ``null`` when the key is
 *  absent. */
function _findTopLevelBlock(
  lines: string[],
  key: string,
): { fromLine: number; toLine: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^${key}\\s*:`));
    if (!m) continue;
    return { fromLine: i + 1, toLine: _findBlockEnd(lines, i, 0) };
  }
  return null;
}

/** Find a nested key directly under a parent block (e.g.
 *  ``actions:`` inside ``api:``). Returns the matched key's
 *  inclusive 1-indexed line range. */
function _findChildBlock(
  lines: string[],
  parentFromLine: number,
  parentToLine: number,
  childKey: string,
): { fromLine: number; toLine: number } | null {
  // Locate the parent block's child indent by reading the first
  // non-blank child line and capturing its leading whitespace —
  // matches the convention used by ``_walkAncestry``.
  let childIndent: number | null = null;
  for (let i = parentFromLine; i < parentToLine && i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const leading = (line.match(/^(\s+)/) ?? ["", ""])[1].length;
    if (leading > 0) {
      childIndent = leading;
      break;
    }
  }
  if (childIndent === null) return null;
  const pattern = new RegExp(`^\\s{${childIndent}}${childKey}\\s*:`);
  for (let i = parentFromLine; i < parentToLine && i < lines.length; i++) {
    if (!pattern.test(lines[i])) continue;
    return { fromLine: i + 1, toLine: _findBlockEnd(lines, i, childIndent) };
  }
  return null;
}

/** List items (``- key: value`` ...) directly inside a top-level
 *  block. Nested list markers (the ``- logger.log`` inside a
 *  ``then:`` clause) are deeper and skipped by pinning to the
 *  block's first-row dash indent. */
function _enumerateListItems(
  lines: string[],
  blockFromLine: number,
  blockToLine: number,
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

/** Read a leading ``key: value`` line inside a list item — used to
 *  pull the script's ``id:`` for the stable section key. */
function _readKeyOnLine(
  lines: string[],
  fromLine: number,
  key: string,
): string | null {
  const target = lines[fromLine - 1];
  // The script id can be on the same line as the leading dash:
  // ``- id: my_alarm`` — or on the next non-empty line.
  const inlineRe = new RegExp(`^\\s*-\\s*${key}:\\s*["']?([^"'\\s]+)["']?`);
  const m = target.match(inlineRe);
  if (m) return m[1];
  const dashIndent = target.match(/^(\s*)-/)?.[1].length ?? 0;
  for (let i = fromLine; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const lineIndent = (line.match(/^(\s*)/) ?? ["", ""])[1].length;
    if (lineIndent <= dashIndent) break;
    const kv = line.match(new RegExp(`^\\s+${key}:\\s*["']?([^"'\\s]+)["']?`));
    if (kv) return kv[1];
  }
  return null;
}

/**
 * Locate the YAML section corresponding to a component that was just
 * added. Used to auto-select that section in the navigator/editor so
 * the user lands on whatever they just created instead of staring at
 * the previously-selected component.
 *
 * `componentId` is the catalog id (e.g. `"wifi"`, `"output.gpio"`,
 * `"binary_sensor.template"`). `newId` is the id field that was
 * submitted (used to disambiguate between multiple instances of the
 * same platform under the same parent block).
 *
 * Returns null when nothing matches — the caller falls back to leaving
 * the previous selection alone.
 */
export function findAddedSection(
  yaml: string,
  componentId: string,
  newId: string | undefined,
): { sectionKey: string; fromLine: number } | null {
  const sections = parseYamlTopLevelSections(yaml);

  // Top-level (non-platform) component — match the bare key, e.g.
  // adding "wifi" navigates to the `wifi:` block.
  if (!componentId.includes(".")) {
    const match = sections.find(
      (s) => s.key === componentId && !s.platform,
    );
    if (match) return { sectionKey: match.key, fromLine: match.fromLine };
  }

  // Platform-based component — find the list item(s) under the parent
  // block whose computed sectionKey matches componentId.
  const candidates = sections.filter(
    (s) => sectionKeyOf(s) === componentId,
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    return {
      sectionKey: sectionKeyOf(candidates[0]),
      fromLine: candidates[0].fromLine,
    };
  }

  // Disambiguate by the submitted id when multiple instances exist
  // (the common "I added a second sensor.dht" case).
  if (newId) {
    const lines = yaml.split("\n");
    const idRe = new RegExp(`^\\s+(?:-\\s+)?id:\\s*["']?${newId}["']?\\s*$`);
    for (const s of candidates) {
      for (let i = s.fromLine - 1; i < s.toLine && i < lines.length; i++) {
        if (idRe.test(lines[i])) {
          return { sectionKey: sectionKeyOf(s), fromLine: s.fromLine };
        }
      }
    }
  }

  // Last resort: pick the candidate that appears latest in the file.
  // The backend typically appends, so the new one is at the bottom.
  const last = candidates[candidates.length - 1];
  return { sectionKey: sectionKeyOf(last), fromLine: last.fromLine };
}

/**
 * Pure line → section mapping used by the YAML pane's cursor
 * handler. Returns the section whose `[fromLine, toLine]` range
 * covers `line` (1-indexed), or `null` when `line` falls in the
 * gap between sections (file header, blank-line interstitial,
 * comment block above a top-level key — the trim done by
 * `parseYamlTopLevelSections` deliberately keeps those gaps
 * unattributed).
 *
 * `find` over the section array — sections are file-ordered with
 * non-overlapping ranges, and at typical config sizes (~10-30
 * sections) the constant factor of a binary search wouldn't beat
 * the linear scan. Worth revisiting only if some pathological
 * file blows the section count past ~50.
 *
 * Pulled out of the page handler (`_onYamlCursorLine`) so the
 * mapping logic is testable without mounting CodeMirror — the
 * handler reduces to "call this, dispatch state if it changed."
 *
 * Inline automations (`on_press:` etc. nested under component
 * blocks, parsed by `parseYamlAutomations`) are deliberately not
 * considered here — the cursor handler currently selects the
 * enclosing component for those lines, which is a known gap vs.
 * clicking the navigator's matching automation entry directly.
 * Tracked as a follow-up to extend `sectionAtLine` to consult
 * automations and prefer the most-specific (smallest) range.
 */
export function sectionAtLine(
  yaml: string,
  line: number,
): YamlSection | null {
  // Automations take precedence over top-level sections whenever a
  // click falls inside one: a click inside ``script: - id: proost``
  // routes to the script editor (not the enclosing ``script:``
  // component-editor); a click inside ``on_press:`` under a
  // ``binary_sensor`` routes to the automation editor for that
  // trigger (not the binary_sensor component editor).
  //
  // Within each layer we still prefer the smallest containing range
  // — for example a nested ``if:`` block's ``then:`` versus its
  // enclosing automation. Top-level fallback covers cases the
  // automation parser doesn't touch (regular components, ``wifi:``,
  // ``esphome:``, etc.).
  // Skip ``automation:unscoped:*`` entries: those mark inline
  // ``on_*:`` handlers whose host component has no ``id:`` and so
  // can't be addressed by the structured editor (location decoder
  // returns null for them). Routing a click there would hand the
  // section editor an unknown key and surface as an error; better
  // to fall through to the enclosing top-level section so the user
  // lands somewhere useful.
  const autos = parseYamlAutomations(yaml).filter(
    (s) => !s.key.startsWith("automation:unscoped:"),
  );
  const autoHit = _smallestContaining(autos, line);
  if (autoHit) return autoHit;
  const tops = parseYamlTopLevelSections(yaml);
  return _smallestContaining(tops, line);
}

function _smallestContaining(
  sections: YamlSection[],
  line: number,
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
 * Compute the section key the navigator uses for a YamlSection. For
 * platform list items, that's `<parent>.<platform>` (de-duplicating
 * if the platform is already namespaced); otherwise just `key`.
 */
export function sectionKeyOf(section: YamlSection): string {
  if (!section.platform) return section.key;
  return section.platform.startsWith(`${section.key}.`)
    ? section.platform
    : `${section.key}.${section.platform}`;
}

/**
 * Resolve the current `fromLine` for `sectionKey` in `yaml`,
 * preferring the section closest to `staleFromLine` when the
 * section key matches multiple list items.
 *
 * The navigator emits `fromLine` at click time; if the YAML
 * shifts afterwards (paste / external edit added or removed
 * lines above the section), the cached number is stale and a
 * splice keyed on it would clip the wrong section. This helper
 * re-resolves against the current YAML so save / delete operate
 * on the right line.
 *
 * Returns the matching section's 1-indexed `fromLine`, or
 * `undefined` when no section in `yaml` matches `sectionKey` —
 * callers surface that as an explicit error rather than running
 * a wrong-line splice. Empty `yaml` or empty `sectionKey` also
 * return `undefined` so an unbound prop and a cleared editor
 * pane collapse into the same caller-visible failure.
 *
 * `undefined` (rather than `null`) so the result drops cleanly
 * into `parseYamlSectionValues`'s optional `fromLine?` parameter
 * without a `?? undefined` conversion at every call site.
 *
 * Same-key duplicates (two `ota.esphome` items — pathological
 * but legal YAML): closest-match is a heuristic, strictly
 * better than ignoring `staleFromLine` but not guaranteed
 * correct. If the user originally clicked the first of two
 * duplicates and a subsequent paste shifted line numbers far
 * enough that the stale line is now closer to the second
 * duplicate, the resolver picks the second. There's no oracle
 * once the array is reshuffled; a re-click is the expected
 * recovery for that case. Equidistant ties prefer the first
 * match (the test pins this; `reduce` with `<` keeps the
 * accumulator on ties).
 */
export function resolveCurrentFromLine(
  yaml: string,
  sectionKey: string,
  staleFromLine?: number,
): number | undefined {
  if (!yaml || !sectionKey) return undefined;
  const matches = parseYamlTopLevelSections(yaml).filter(
    (s) => sectionKeyOf(s) === sectionKey,
  );
  if (matches.length === 0) return undefined;
  if (matches.length === 1 || staleFromLine === undefined) {
    return matches[0].fromLine;
  }
  return matches.reduce((best, candidate) =>
    Math.abs(candidate.fromLine - staleFromLine) <
    Math.abs(best.fromLine - staleFromLine)
      ? candidate
      : best,
  ).fromLine;
}
