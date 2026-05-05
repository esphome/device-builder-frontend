/**
 * Minimal YAML helpers for ConfigEntry form values.
 *
 * `serializeYamlValues` is used by the section editor (to write a
 * section back into the device YAML) and by the add-component dialog
 * (to render a live preview). It handles scalars, arrays of scalars,
 * nested objects, and `YamlRawValue` opaque blocks; empty/null/undefined
 * values are skipped.
 *
 * `parseTopLevelComponents` walks the YAML to find every top-level
 * key (e.g. `wifi:`, `mqtt:`, `output:`). Both forms use it to
 * evaluate `depends_on_component` predicates and component-level
 * dependency checks against the user's current configuration.
 */

/**
 * Opaque wrapper for a section-value block the parser couldn't fully
 * model — block scalars (`lambda: |-`), automation handlers with
 * sub-dict list items (`on_press:` → `- then:` → ...), or any other
 * shape that round-trips byte-for-byte but doesn't fit
 * `string | string[] | Record<string, unknown>`.
 *
 * The instance carries the original body lines verbatim (with their
 * leading whitespace). The serializer pastes them back under the
 * `key:` header — optionally suffixed with `inlineHeader` (the
 * `|-` / `>+` marker that has to sit on the SAME line as `key:`,
 * not on its own line). The form edits fields it understands (a
 * button's `name`, `icon`, `device_class`) without mangling the
 * automation block it doesn't.
 *
 * Two shapes:
 *   1. List-rooted block (`on_press:` → `- lambda: ...` → body):
 *      `inlineHeader` is undefined, `lines` includes the dash row
 *      and everything underneath.
 *   2. Direct block scalar (`lambda: |-` → body):
 *      `inlineHeader = "|-"`, `lines` is the body only. The
 *      serializer emits `key: |-` and then the body, preserving
 *      the YAML's required header-on-same-line shape.
 *
 * Class identity (rather than a sentinel property) so a YAML key
 * called `__raw` or similar can't accidentally trigger raw-mode on
 * round-trip. ``setIn`` (used by the form) copies values by
 * reference through ``{...obj}`` spread, so the class identity
 * survives form mutations.
 */
export class YamlRawValue {
  constructor(
    public readonly lines: readonly string[],
    public readonly inlineHeader?: string,
  ) {}
}

/** Options for ``serializeYamlValues``. */
export interface SerializeYamlOptions {
  /**
   * Preserve empty-string values (``foo: ""``) instead of
   * dropping them. Default ``false`` matches the form's
   * "user cleared the field" semantics for ordinary
   * config-entries. Set ``true`` for top-level user-keyed
   * sections (``substitutions:``) where every key the user
   * typed is intentional data and ``""`` is a valid value
   * the YAML must round-trip. (Copilot-flagged: without this
   * a save in the substitutions section silently drops any
   * existing empty-string substitution.)
   */
  keepEmptyStrings?: boolean;
}

/**
 * Serialize a values dict as YAML lines at the given indent.
 * Returns an array of lines (not a joined string) so callers can
 * splice them into existing YAML when needed.
 */
export function serializeYamlValues(
  values: Record<string, unknown>,
  indent: string,
  options: SerializeYamlOptions = {},
): string[] {
  const lines: string[] = [];
  const keepEmpty = options.keepEmptyStrings === true;
  for (const [key, val] of Object.entries(values)) {
    if (val === undefined || val === null) continue;
    if (val === "" && !keepEmpty) continue;
    if (val instanceof YamlRawValue) {
      // Raw block (block scalar, automation handler, …). Lines
      // already carry their original indentation — emit `key:`
      // (with the inline `|-` / `>+` marker when present) and
      // paste them back unchanged. `instanceof` check before
      // the generic `typeof === "object"` branch so the class
      // identity wins over the plain-object handling below.
      if (val.lines.length === 0 && !val.inlineHeader) continue;
      const header = val.inlineHeader ? ` ${val.inlineHeader}` : "";
      lines.push(`${indent}${key}:${header}`);
      lines.push(...val.lines);
      continue;
    }
    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      lines.push(`${indent}${key}:`);
      for (const item of val) {
        lines.push(`${indent}  - ${formatYamlScalar(item)}`);
      }
      continue;
    }
    if (typeof val === "object") {
      // Thread ``options`` through the recursion so
      // ``keepEmptyStrings`` applies at every depth — without
      // this, an empty string inside a nested mapping would
      // still be dropped while the top level kept them, which
      // is surprising and loses data on round-trip. (Copilot.)
      const sub = serializeYamlValues(
        val as Record<string, unknown>,
        `${indent}  `,
        options,
      );
      if (sub.length === 0) continue;
      lines.push(`${indent}${key}:`);
      lines.push(...sub);
      continue;
    }
    lines.push(`${indent}${key}: ${formatYamlScalar(val)}`);
  }
  return lines;
}

/**
 * Extract the set of top-level component keys configured in the YAML
 * (e.g. `["wifi", "api", "mqtt", "switch"]`). Used to evaluate
 * `depends_on_component` predicates on config entries and the
 * component-level `dependencies` list on the catalog entry.
 */
export function parseTopLevelComponents(yaml: string): Set<string> {
  const present = new Set<string>();
  for (const line of yaml.split("\n")) {
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (match) present.add(match[1]);
  }
  return present;
}

/**
 * Walk the YAML and return the set of platform-qualified ids that
 * are already configured under their domain umbrella. For example,
 *
 *   time:
 *     - platform: homeassistant
 *       id: ha_time
 *     - platform: sntp
 *
 * yields `Set { "time.homeassistant", "time.sntp" }`. Used by the
 * component catalog to hide single-instance platform components
 * (e.g. `time.homeassistant`) once they're already in use, so the
 * "Add component" dialog doesn't let the user duplicate them.
 *
 * Best-effort scan — looks for top-level keys followed by list
 * items containing `platform:`. Doesn't try to parse nested
 * dictionaries or anchors; the catalog filter is forgiving (it
 * only HIDES things, never blocks the user from adding via YAML).
 */
export function parseConfiguredPlatforms(yaml: string): Set<string> {
  const out = new Set<string>();
  if (!yaml) return out;
  const lines = yaml.split("\n");
  let currentDomain: string | null = null;
  for (const line of lines) {
    const top = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(?:#.*)?$/);
    if (top) {
      currentDomain = top[1];
      continue;
    }
    if (!currentDomain) continue;
    // Only consider lines indented under the current domain. Two
    // spaces is the canonical ESPHome indentation; we accept any
    // leading whitespace to be lenient.
    const platform = line.match(
      /^\s+(?:-\s+)?platform:\s*["']?(\S+?)["']?\s*(?:#.*)?$/,
    );
    if (platform) {
      out.add(`${currentDomain}.${platform[1]}`);
    }
  }
  return out;
}

/** Format a single scalar value, quoting when needed. */
export function formatYamlScalar(v: unknown): string {
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return String(v);
  const s = String(v);
  // Empty string must be quoted: a bare ``key: `` round-trips as
  // YAML ``null``, not as the empty string we started with. Only
  // matters when the caller has opted into keep-empty-strings
  // (default is to drop the key entirely), but the formatter is
  // shared so we get it right at the source.
  if (s === "" || /[:#]/.test(s) || /^[-\s'"]/.test(s) || /\s$/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}
