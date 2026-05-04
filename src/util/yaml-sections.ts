export interface YamlSection {
  key: string;
  fromLine: number; // 1-indexed (CodeMirror convention)
  toLine: number; // 1-indexed, inclusive
  name?: string; // "name:" value from a YAML list item
  id?: string; // "id:" value from a YAML list item
  platform?: string; // "platform:" value from a YAML list item
  parentKey?: string; // top-level key when this is an expanded list item
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
 * Extracts top-level YAML keys and their line ranges.
 * Top-level keys have no leading whitespace (e.g. `esphome:`, `wifi:`).
 * Sections containing YAML list items (e.g. `light:\n  - platform: binary`)
 * are expanded so each list item becomes its own section with name/platform metadata.
 */
export function parseYamlTopLevelSections(yaml: string): YamlSection[] {
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

  return sections;
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
 * Finds inline ESPHome automation handlers (on_press:, on_value_range:, etc.)
 * nested inside component definitions and returns them as navigable sections.
 * The key is formatted as "<component name> → <event>" when a name is available.
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

    // End of block = first non-empty line at same or lower indentation
    let toLine = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") continue;
      const lineIndent = (lines[j].match(/^(\s*)/) ?? ["", ""])[1].length;
      if (lineIndent <= indent) {
        toLine = j; // array index j = CM line j (last line of this block is j-1+1 = j)
        break;
      }
    }

    // Look backwards for the nearest `name:` within the same component item
    let parentName = "";
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].match(/^[a-zA-Z]/)) break; // hit a top-level key
      const nameMatch = lines[j].match(/^\s+name:\s*["']?(.+?)["']?\s*$/);
      if (nameMatch) {
        parentName = nameMatch[1];
        break;
      }
    }

    automations.push({
      key: parentName ? `${parentName} → ${eventName}` : eventName,
      fromLine,
      toLine,
    });
  }

  return automations;
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
