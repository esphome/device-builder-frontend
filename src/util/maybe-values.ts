/**
 * Expansion of esphome's 'maybe_simple_value' shorthand in parsed
 * section values, driven by the catalog's ConfigEntry.maybe_key: a bare
 * scalar at a NESTED entry stands for '{[maybe_key]: scalar}', and with
 * multi_value a non-list value stands for a one-item list whose items may
 * themselves be bare scalars. Run once at section load so the stored
 * form state always holds the canonical mapping/list shape - the
 * renderers, dotted-path reads, and edits all address that shape. A
 * scalar left in place at a multi_value entry would render as an empty
 * list and be clobbered by the first edit; at a single nested entry it
 * would fall to the read-only value-set-in-YAML notice instead of
 * populating the group. The YAML keeps its shorthand until the section
 * is next written (canonicalize-on-edit, same policy as legacy key
 * respelling).
 */
import type { ConfigEntry } from "../api/types/config-entries.js";
import { ConfigEntryType } from "../api/types/config-entries.js";
import { isPlainObject } from "./nested-values.js";

/**
 * Expand maybe_simple_value shorthands in *values* against *entries*.
 *
 * Returns the input identity-equal when nothing needed expanding;
 * otherwise a fresh clone preserving the input's prototype (the section
 * parser hands back null-prototype maps as a __proto__ defence, and a
 * plain spread would silently re-open that).
 */
export function normalizeMaybeValues(
  values: Record<string, unknown>,
  entries: ConfigEntry[]
): Record<string, unknown> {
  const [changed, next] = normalizeChildren(values, entries);
  return changed ? (next as Record<string, unknown>) : values;
}

/** A YAML scalar the shorthand applies to; excludes mappings, lists, and
 *  parser wrappers like YamlRawValue (object-typed, passed through). */
function isScalarValue(value: unknown): boolean {
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean" || t === "bigint";
}

/** A parsed YAML mapping. Stricter than isPlainObject: class instances
 *  (YamlRawValue and friends) must pass through untouched, or the
 *  renderers' raw-block bail-outs stop seeing them. */
function isMappingValue(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function cloneContainer(source: Record<string, unknown>): Record<string, unknown> {
  return Object.create(
    Object.getPrototypeOf(source),
    Object.getOwnPropertyDescriptors(source)
  );
}

function normalizeChildren(
  container: Record<string, unknown>,
  entries: ConfigEntry[]
): [boolean, unknown] {
  let out: Record<string, unknown> | null = null;
  for (const entry of entries) {
    if (entry.type !== ConfigEntryType.NESTED) continue;
    const value = container[entry.key];
    if (value === undefined || value === null) continue;
    const [changed, next] = normalizeEntryValue(entry, value);
    if (!changed) continue;
    out ??= cloneContainer(container);
    out[entry.key] = next;
  }
  return out ? [true, out] : [false, container];
}

function normalizeEntryValue(entry: ConfigEntry, value: unknown): [boolean, unknown] {
  const maybeKey = entry.maybe_key ?? null;
  const children = entry.config_entries ?? [];
  if (!entry.multi_value) {
    return normalizeItem(value, maybeKey, children);
  }
  if (Array.isArray(value)) {
    let items: unknown[] | null = null;
    value.forEach((item, i) => {
      const [changed, next] = normalizeItem(item, maybeKey, children);
      if (!changed) return;
      items ??= [...value];
      items[i] = next;
    });
    return items ? [true, items] : [false, value];
  }
  // A non-list value at a multi_value maybe entry is ensure_list's
  // single-item shorthand: a bare scalar or a bare mapping.
  if (maybeKey && (isScalarValue(value) || isMappingValue(value))) {
    const [, item] = normalizeItem(value, maybeKey, children);
    return [true, [item]];
  }
  return [false, value];
}

function normalizeItem(
  item: unknown,
  maybeKey: string | null,
  children: ConfigEntry[]
): [boolean, unknown] {
  if (maybeKey && isScalarValue(item)) {
    return [true, { [maybeKey]: item }];
  }
  if (isMappingValue(item)) {
    // Descend regardless of maybeKey: a shorthand can sit on a nested
    // descendant (sprinkler's valves[].valve_switch).
    return normalizeChildren(item, children);
  }
  return [false, item];
}
