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

import { isLambdaValue } from "../api/types.js";
import { ESPHOME_YAML_INDENT } from "./esphome-yaml-lang.js";
import { isPlainObject } from "./nested-values.js";

/**
 * Wrap a ``LambdaValue`` sentinel (``{_lambda: "<body>"}``) as a
 * ``YamlRawValue`` so the serializer's existing block-scalar path
 * handles the emission. Bare ``|-`` (no ``!lambda`` tag) mirrors
 * the backend's ``controllers/automations/emitter.encode_value``
 * convention; the ESPHome parser accepts both forms.
 *
 * Without this conversion the form serializer falls through the
 * generic ``typeof val === "object"`` recursion and emits the
 * sentinel as ``key:\n  _lambda: "raw\nbody"``. The double-quoted
 * scalar doesn't escape embedded newlines, so the YAML is invalid
 * and ``findSectionRange`` can't locate the section on the next
 * save; each keystroke then appends a fresh copy alongside the
 * malformed one. #940.
 */
function lambdaToRawValue(body: string, bodyIndent: string): YamlRawValue {
  const lines = body
    .split("\n")
    .map((line) => (line === "" ? "" : `${bodyIndent}${line}`));
  return new YamlRawValue(lines, "|-");
}

/**
 * Emit a ``YamlRawValue`` under *key* at the given indent. Shared
 * by the top-level and list-item serializers (which both need the
 * same header + body shape) and by the ``LambdaValue`` dispatch.
 *
 * Returns an empty array when the value has no body and no header,
 * mirroring the pre-existing skip in ``serializeYamlValues`` for a
 * raw value that would emit just a bare ``key:`` line.
 */
function emitYamlRawValueLines(key: string, indent: string, raw: YamlRawValue): string[] {
  if (raw.lines.length === 0 && !raw.inlineHeader) return [];
  const header = raw.inlineHeader ? ` ${raw.inlineHeader}` : "";
  return [`${indent}${key}:${header}`, ...raw.lines];
}

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
    public readonly inlineHeader?: string
  ) {}

  /**
   * Common leading-whitespace prefix of every non-blank line, or
   * empty string when there are no non-blank lines. Used by
   * ``body`` to dedent the editor view and by edit handlers to
   * re-indent a user's freshly-typed text on round-trip.
   */
  get indent(): string {
    const nonBlank = this.lines.filter((line) => line.trim() !== "");
    if (nonBlank.length === 0) return "";
    let common = nonBlank[0].match(/^\s*/)?.[0] ?? "";
    for (const line of nonBlank.slice(1)) {
      const lead = line.match(/^\s*/)?.[0] ?? "";
      // Walk backwards from the current common prefix shrinking
      // until both lines agree.
      while (common && !line.startsWith(common)) {
        common = common.slice(0, -1);
      }
      // Defensive: if the loop above zeroed out, the lines disagree
      // at column 0 — fall through to the empty string.
      if (!common) return "";
      // Cap at the new line's leading whitespace so we don't keep
      // a longer prefix than this line actually has.
      if (lead.length < common.length) common = lead;
    }
    return common;
  }

  /**
   * The block-scalar body as the user typed it semantically,
   * with the common indent stripped — what a textarea / lambda
   * editor wants to render. For example a ``YamlRawValue`` whose
   * ``lines`` is ``["    return foo;", "    return bar;"]``
   * displays as ``"return foo;\nreturn bar;"``.
   *
   * Round-trip pairing: ``YamlRawValue.fromBodyText(body, original)``
   * goes the other direction, re-applying the common indent so
   * the resulting lines slot back into the YAML at the original
   * depth.
   */
  get body(): string {
    const indent = this.indent;
    return this.lines.map((line) => line.slice(indent.length)).join("\n");
  }

  /**
   * Coercion path so ``String(rawValue)`` and ``${rawValue}`` produce
   * the dedented body instead of the default ``[object Object]`` —
   * the bug behind issue #428 (the lambda field rendering as
   * ``[object Object]`` for any block-scalar value the YAML parser
   * captured into a ``YamlRawValue``).
   */
  toString(): string {
    return this.body;
  }

  /**
   * Build a new ``YamlRawValue`` from an editor-friendly body
   * string, re-applying the original ``YamlRawValue``'s indent and
   * preserving its inline header. Used when the user edits a
   * lambda / multi-line block scalar in the form: feed in the
   * textarea's value, get back a properly-indented round-trippable
   * ``YamlRawValue`` to write into the form's values dict.
   *
   * When *original* has no inline header (list-rooted block) the
   * caller probably shouldn't be using a textarea at all — that
   * shape carries its own dash row inside ``lines`` — so this
   * helper drops it on the floor and treats the value as a fresh
   * inline-header-less block. Callers that care about the
   * list-rooted shape should special-case it before calling this.
   */
  static fromBodyText(body: string, original: YamlRawValue): YamlRawValue {
    const indent = original.indent;
    const lines = body.split("\n").map((line) => (line === "" ? "" : `${indent}${line}`));
    return new YamlRawValue(lines, original.inlineHeader);
  }
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
  /**
   * Indent step for one level deeper. Defaults to
   * ``ESPHOME_YAML_INDENT`` (two spaces, the canonical emit
   * format). Pass the user's detected step (e.g. ``"    "`` for
   * a 4-space file) so saves preserve the surrounding YAML's
   * indentation instead of splicing canonical 2-space content
   * into a 4-space file.
   */
  indentStep?: string;
}

/**
 * Serialize a single list item. Mapping items
 * (``esphome.devices`` / ``esphome.areas`` shape — the new
 * ``multi_value=true`` schema entries) emit as
 * ``${indent}  - first_key: value`` followed by
 * ``${indent}    other_key: value`` for each remaining field;
 * scalar items keep the legacy ``${indent}  - value`` shape.
 *
 * Per-field skip rules match the top-level serializer
 * (``undefined`` / ``null`` / empty-string unless
 * ``keepEmptyStrings``). When all fields are filtered out — or
 * the item is literally ``{}`` (a freshly-added Add row the user
 * hasn't filled yet) — emit a bare ``${indent}  -`` placeholder
 * so the row survives the round-trip. The parser's
 * ``collectBlockListMappings`` recognises bare dashes and
 * rebuilds the empty mapping on reload; without the placeholder
 * the user's in-progress row would silently vanish.
 *
 * ``YamlRawValue`` values inside an item are emitted with the
 * same inline-header / body shape as the top-level branch.
 */
function serializeListItem(
  item: unknown,
  indent: string,
  options: SerializeYamlOptions
): string[] {
  const keepEmpty = options.keepEmptyStrings === true;
  const step = options.indentStep ?? ESPHOME_YAML_INDENT;
  const dashIndent = `${indent}${step}`;
  if (isPlainObject(item)) {
    const entries = Object.entries(item).filter(
      ([, v]) => v !== undefined && v !== null && (v !== "" || keepEmpty)
    );
    if (entries.length === 0) return [`${dashIndent}-`];
    const lines: string[] = [];
    // Follow-up sub-keys align with the inline first key (which
    // sits at ``${dashIndent}- ``, a fixed two-character offset
    // past the dash) — NOT at ``${dashIndent}${step}``. With a
    // canonical 2-space step those happen to coincide, but on a
    // 4-space user file ``${dashIndent}${step}`` lands sub-keys
    // four columns deeper than the inline key, producing
    // valid-but-misaligned YAML. ``ESPHOME_YAML_INDENT`` is the
    // canonical 2-character "- " gap and stays fixed.
    const childIndent = `${dashIndent}${ESPHOME_YAML_INDENT}`;
    entries.forEach(([k, v], idx) => {
      const prefix = idx === 0 ? `${dashIndent}- ` : childIndent;
      if (v instanceof YamlRawValue) {
        lines.push(...emitYamlRawValueLines(k, prefix, v));
        return;
      }
      if (isLambdaValue(v)) {
        const raw = lambdaToRawValue(v._lambda, `${childIndent}${ESPHOME_YAML_INDENT}`);
        lines.push(...emitYamlRawValueLines(k, prefix, raw));
        return;
      }
      lines.push(`${prefix}${k}: ${formatYamlScalar(v)}`);
    });
    return lines;
  }
  return [`${dashIndent}- ${formatYamlScalar(item)}`];
}

/**
 * Serialize a values dict as YAML lines at the given indent.
 * Returns an array of lines (not a joined string) so callers can
 * splice them into existing YAML when needed.
 */
export function serializeYamlValues(
  values: Record<string, unknown>,
  indent: string,
  options: SerializeYamlOptions = {}
): string[] {
  const lines: string[] = [];
  const keepEmpty = options.keepEmptyStrings === true;
  const step = options.indentStep ?? ESPHOME_YAML_INDENT;
  for (const [key, val] of Object.entries(values)) {
    if (val === undefined || val === null) continue;
    if (val === "" && !keepEmpty) continue;
    if (val instanceof YamlRawValue) {
      // Raw block (block scalar, automation handler, …). Lines
      // already carry their original indentation; emit ``key:``
      // (with the inline ``|-`` / ``>+`` marker when present) and
      // paste them back unchanged. ``instanceof`` check before
      // the generic ``typeof === "object"`` branch so the class
      // identity wins over the plain-object handling below.
      lines.push(...emitYamlRawValueLines(key, indent, val));
      continue;
    }
    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      lines.push(`${indent}${key}:`);
      for (const item of val) {
        const itemLines = serializeListItem(item, indent, options);
        lines.push(...itemLines);
      }
      continue;
    }
    if (isLambdaValue(val)) {
      const raw = lambdaToRawValue(val._lambda, `${indent}${step}`);
      lines.push(...emitYamlRawValueLines(key, indent, raw));
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
        `${indent}${step}`,
        options
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
    const platform = line.match(/^\s+(?:-\s+)?platform:\s*["']?(\S+?)["']?\s*(?:#.*)?$/);
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

// ESPHome's YAML loader accepts the YAML 1.1 truthy/falsy spellings
// plus ``enable`` / ``disable``, all case-insensitive
// (https://esphome.io/guides/yaml#scalars). The minimal scalar parser
// in this repo only recognised lowercase ``true`` / ``false``, so a
// user-typed ``True`` or ``enable`` round-tripped as a string and the
// boolean toggle in the form view stuck OFF (issue device-builder#923).
const YAML_TRUE_VALUES = new Set(["true", "yes", "on", "enable"]);
const YAML_FALSE_VALUES = new Set(["false", "no", "off", "disable"]);

/**
 * Coerce *v* to boolean using ESPHome YAML's truthy/falsy spellings.
 * Returns ``null`` when the input is neither a boolean nor one of the
 * recognised string spellings — callers treat ``null`` as "not a
 * boolean, leave the value as-is" (scalar parser) or "fall through to
 * the default" (form renderer).
 */
export function parseYamlBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const lower = v.toLowerCase();
    if (YAML_TRUE_VALUES.has(lower)) return true;
    if (YAML_FALSE_VALUES.has(lower)) return false;
  }
  return null;
}
