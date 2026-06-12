import { parseYamlAutomations } from "./yaml-automations.js";
import {
  _clearYamlSectionsMemo,
  findFieldLine,
  instanceComponentId,
  parseYamlTopLevelSections,
  smallestContainingSection,
  type YamlSection,
} from "./yaml-sections-core.js";

// The section-parsing primitives live in ``yaml-sections-core.ts`` (a
// leaf module) so ``yaml-automations.ts`` can reuse them without a
// circular import. Re-exported here so existing call sites importing
// them — or ``parseYamlAutomations`` — from ``./yaml-sections.js`` are
// unaffected.
export {
  _clearYamlSectionsMemo,
  findFieldLine,
  instanceComponentId,
  parseYamlAutomations,
  parseYamlTopLevelSections,
  smallestContainingSection,
  type YamlSection,
};

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
  "esp32",
  "esp8266",
  "rp2040",
  "bk72xx",
  "rtl87xx",
  "ln882x",
  "nrf52",
  "host",
  // ESPHome infrastructure
  "esphome",
  "logger",
  "api",
  "ota",
  "wifi",
  "ethernet",
  "mqtt",
  "mdns",
  "network",
  "web_server",
  "captive_portal",
  "improv_serial",
  "safe_mode",
  "debug",
  "preferences",
  "update",
  // Device-wide config keys (not strictly components — no C++
  // implementation — but they share the top-level YAML namespace
  // alongside real components).
  "external_components",
  "packages",
  "substitutions",
  "dashboard_import",
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
  newId: string | undefined
): { sectionKey: string; fromLine: number } | null {
  const sections = parseYamlTopLevelSections(yaml);

  // Top-level (non-platform) component — match the bare key, e.g.
  // adding "wifi" navigates to the `wifi:` block.
  if (!componentId.includes(".")) {
    const match = sections.find((s) => s.key === componentId && !s.platform);
    if (match) return { sectionKey: match.key, fromLine: match.fromLine };
  }

  // Platform-based component — find the list item(s) under the parent
  // block whose computed sectionKey matches componentId.
  const candidates = sections.filter((s) => sectionKeyOf(s) === componentId);
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
    // The id is form input — escape it so the match is literal.
    const escapedId = newId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const idRe = new RegExp(`^\\s*(?:-\\s+)?id:\\s*["']?${escapedId}["']?\\s*$`);
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
export function sectionAtLine(yaml: string, line: number): YamlSection | null {
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
  // ``on_*:`` handlers with no addressable host (a flat single-
  // instance block, or no resolvable enclosing block) — the location
  // decoder returns null for them. Routing a click there would hand
  // the section editor an unknown key and surface as an error; better
  // to fall through to the enclosing top-level section so the user
  // lands somewhere useful. id-less list-item instances are *not*
  // unscoped (they resolve to a positional ``<domain>_<idx>``), so
  // their triggers route normally.
  const autos = parseYamlAutomations(yaml).filter(
    (s) => !s.key.startsWith("automation:unscoped:")
  );
  const autoHit = smallestContainingSection(autos, line);
  if (autoHit) return autoHit;
  const tops = parseYamlTopLevelSections(yaml);
  return smallestContainingSection(tops, line);
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
  staleFromLine?: number
): number | undefined {
  if (!yaml || !sectionKey) return undefined;
  const matches = parseYamlTopLevelSections(yaml).filter(
    (s) => sectionKeyOf(s) === sectionKey
  );
  if (matches.length === 0) return undefined;
  if (matches.length === 1 || staleFromLine === undefined) {
    return matches[0].fromLine;
  }
  return matches.reduce((best, candidate) =>
    Math.abs(candidate.fromLine - staleFromLine) < Math.abs(best.fromLine - staleFromLine)
      ? candidate
      : best
  ).fromLine;
}
