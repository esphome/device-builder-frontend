/**
 * Per-entry value validation primitives, split out of
 * `config-validation.ts` to keep that module under the file-size band:
 * `validateEntry`'s typed branch cascade (integer, hex, float, boolean,
 * float-with-unit, options) plus the shared predicates it and the
 * traversal both lean on. This is a leaf module — it imports nothing
 * from `config-validation.ts`.
 *
 * `config-validation.ts` re-exports everything here, so existing call
 * sites importing these from `./config-validation.js` are unaffected.
 */

import { isLambdaValue } from "../api/types/automations.js";
import type { ConfigEntry, ConfigValueOption } from "../api/types/config-entries.js";
import { ConfigEntryType } from "../api/types/config-entries.js";
import { parseFloatWithUnit } from "./float-with-unit.js";
import { parseHexInt } from "./hex-int.js";
import { parseIntInput } from "./int-input.js";
import { isSubstitutionString } from "./substitutions.js";
import { parseYamlBoolean } from "./yaml-serialize.js";

export interface ValidationError {
  key: string;
  code: string;
  params?: Record<string, string | number>;
}

/** The canonical option whose value matches `value` case-insensitively but not
 *  exactly, else null. Drives a soft "did you mean" hint for custom-value
 *  comboboxes — a user who typed `l` where the catalog only offers `L`. Matches
 *  on option value only (never label), and yields nothing when an exact-case
 *  option exists, so a deliberately case-distinct custom value never nags. */
export function nearCanonicalOption(
  value: string,
  options: readonly ConfigValueOption[] | null
): string | null {
  if (!value || !options || options.length === 0) return null;
  const lower = value.toLowerCase();
  let near: string | null = null;
  for (const opt of options) {
    if (opt.value === value) return null;
    if (near === null && opt.value.toLowerCase() === lower) near = opt.value;
  }
  return near;
}

/**
 * A value counts as "present" for required / constraint-group purposes
 * unless it's nullish, a blank/whitespace string, or an empty array.
 * Shared so `validateEntry` and the constraint-group evaluator agree on
 * what "set" means.
 */
export function isValuePresent(raw: unknown): boolean {
  return !(
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && raw.trim() === "") ||
    (Array.isArray(raw) && raw.length === 0)
  );
}

export function validateEntry(entry: ConfigEntry, raw: unknown): ValidationError | null {
  // UNKNOWN renders as the YAML-only notice (a mapping-or-list union the
  // form can't edit), so there is nothing to validate; a required one must
  // not block the wizard with an error the user can't clear in the form.
  if (entry.type === ConfigEntryType.UNKNOWN) return null;

  const isEmpty = !isValuePresent(raw);
  // An unset hidden field isn't rendered, so never block on it; a set one
  // is visible and validates normally.
  if (entry.hidden && isEmpty) return null;

  if (entry.required && isEmpty) {
    return { key: entry.key, code: "validation.required" };
  }
  if (isEmpty) return null;

  // A ${var} reference resolves at build time, so its value is unknowable
  // here; skip all validation (range, options, not-a-number) for the literal
  // or a mid-edit partial (#1391).
  if (isSubstitutionString(raw)) return null;

  // A !lambda on a templatable field resolves at runtime the same way;
  // the typed branches would stringify it to "[object Object]" and flag
  // a valid value as not-a-number.
  if (isLambdaValue(raw)) return null;

  if (entry.type === ConfigEntryType.INTEGER && entry.display_format === "hex") {
    // BigInt-route the hex-typed integer check so cv.hex_uint64_t
    // range bounds stay honest (#944 follow-up). ``Number(String(raw))``
    // would round any value above 2^53 before the comparison, and the
    // catalog's max for uint64 (2^64 - 1) is already imprecise after
    // JSON.parse — comparing a precise input against an imprecise
    // bound is wrong. ``parseHexInt`` accepts the canonical strings
    // the renderer emits and any non-negative decimal a fixture / test
    // might pass; numbers / bigints stringify through the same path.
    const canonical = parseHexInt(String(raw));
    if (canonical === null) {
      return { key: entry.key, code: "validation.not_a_number" };
    }
    if (entry.range) {
      const n = BigInt(canonical);
      const [min, max] = entry.range;
      // ``Math.floor`` / ``Math.ceil`` widen the bounds at sub-integer
      // edges in the lenient direction; the backend's cv.hex_int
      // validator is the source of truth either way.
      if (n < BigInt(Math.floor(min))) {
        return { key: entry.key, code: "validation.min", params: { min } };
      }
      if (n > BigInt(Math.ceil(max))) {
        return { key: entry.key, code: "validation.max", params: { max } };
      }
    }
  } else if (entry.type === ConfigEntryType.INTEGER) {
    // Accept exactly what cv.int_ does — bare decimal or 0x hex — so the
    // editor doesn't pass forms (`1e3`) the backend rejects, and range-check
    // with BigInt so the 64-bit values the renderer keeps as strings compare
    // precisely. ``1.5`` / ``1e3`` parse as numbers but aren't integer
    // literals (``not_an_integer``); junk isn't numeric (``not_a_number``).
    const n = parseIntInput(raw);
    if (n === null) {
      const numeric = !Number.isNaN(Number(String(raw).trim()));
      return {
        key: entry.key,
        code: numeric ? "validation.not_an_integer" : "validation.not_a_number",
      };
    }
    if (entry.range) {
      const [min, max] = entry.range;
      if (n < BigInt(Math.floor(min))) {
        return { key: entry.key, code: "validation.min", params: { min } };
      }
      if (n > BigInt(Math.ceil(max))) {
        return { key: entry.key, code: "validation.max", params: { max } };
      }
    }
  } else if (entry.type === ConfigEntryType.FLOAT) {
    const num = typeof raw === "number" ? raw : Number(String(raw));
    // isFinite, not just NaN: a stored "1e309"/"Infinity" is no float the
    // backend accepts, and the text field it renders in needs the error.
    if (!Number.isFinite(num)) {
      return { key: entry.key, code: "validation.not_a_number" };
    }
    if (entry.range) {
      const [min, max] = entry.range;
      if (num < min) {
        return { key: entry.key, code: "validation.min", params: { min } };
      }
      if (num > max) {
        return { key: entry.key, code: "validation.max", params: { max } };
      }
    }
  } else if (entry.type === ConfigEntryType.BOOLEAN) {
    if (parseYamlBoolean(raw) === null) {
      return { key: entry.key, code: "validation.not_a_boolean" };
    }
  }

  if (entry.type === ConfigEntryType.FLOAT_WITH_UNIT) {
    // Validate the numeric portion of the unit-suffixed string. Range
    // checks only apply when the value is in the canonical unit — the
    // catalog's `range` for `cv.frequency` etc. is post-coercion and
    // a user picking `mHz` for a frequency in `Hz` produces a number
    // outside the canonical bounds even when the YAML round-trips
    // fine.
    const parsed = parseFloatWithUnit(raw, entry.unit_options ?? []);
    if (parsed.value === null) {
      return { key: entry.key, code: "validation.not_a_number" };
    }
    const canonicalUnit = entry.unit_options?.[0] ?? "";
    if (entry.range && parsed.unit === canonicalUnit) {
      const [min, max] = entry.range;
      if (parsed.value < min) {
        return { key: entry.key, code: "validation.min", params: { min } };
      }
      if (parsed.value > max) {
        return { key: entry.key, code: "validation.max", params: { max } };
      }
    }
  }

  // Validate against the option list when present — but skip the check
  // for fields that opt into custom values (combobox-style entries treat
  // `options` as suggestions, not a fixed set).
  if (entry.options && entry.options.length > 0 && !entry.allow_custom_value) {
    const rawStr = String(raw);
    const allowed = entry.options.map((o) => o.value);
    // A case-only difference is accepted: esphome's `cv.one_of(..., upper=True)`
    // normalizes case, so a board-written `esp32` against a catalog `ESP32`
    // option compiles fine and the form already resolves it case-insensitively.
    if (
      !allowed.includes(rawStr) &&
      nearCanonicalOption(rawStr, entry.options) === null
    ) {
      return { key: entry.key, code: "validation.invalid_option" };
    }
  }

  return null;
}
