/**
 * Parse and serialize ESPHome time-period scalars (`50ms`, `1sec`,
 * `34.1seconds`) for the structured editor's value + unit widgets.
 *
 * The dashboard offers six canonical units; ESPHome's
 * `cv.time_period_str_unit` accepts a wider alias set (`sec` and
 * `seconds` for `s`, `milliseconds` for `ms`, ...). We normalize every
 * accepted suffix onto its canonical unit so an aliased value still
 * splits into the picker instead of blanking out. `ns` / `nanoseconds`
 * have no canonical picker unit and fall through to the raw-text editor.
 *
 * A field's precision (`duration_min_unit`) narrows the picker to the
 * units ESPHome accepts for it.
 */

import { isPlainObject } from "./nested-values.js";

/** Canonical units the time-period / interval pickers offer, least to
 *  most coarse. */
export const TIME_PERIOD_UNITS = ["us", "ms", "s", "min", "h", "d"] as const;
export type TimePeriodUnit = (typeof TIME_PERIOD_UNITS)[number];

/** Units the picker offers for a field: *minUnit* (the catalog's
 *  `duration_min_unit`) and coarser; `ns` is finer than any of them. The unit
 *  a stored value already uses stays listed, so an existing `4us` still
 *  shows its unit instead of a blank picker. An absent or unknown
 *  *minUnit* offers every unit. */
export function timePeriodUnitsFor(
  minUnit: string | null | undefined,
  inUse?: TimePeriodUnit
): readonly TimePeriodUnit[] {
  const first = TIME_PERIOD_UNITS.indexOf(minUnit as TimePeriodUnit);
  if (first <= 0) return TIME_PERIOD_UNITS;
  return TIME_PERIOD_UNITS.filter((u, i) => i >= first || u === inUse);
}

/** *unit*, or *minUnit* when *unit* is finer than the field accepts: the
 *  unit an empty field starts on, so a first keystroke can't write one
 *  ESPHome rejects. */
export function clampTimePeriodUnit(
  unit: TimePeriodUnit,
  minUnit: string | null | undefined
): TimePeriodUnit {
  return timePeriodUnitsFor(minUnit).includes(unit) ? unit : (minUnit as TimePeriodUnit);
}

/** Every time-unit suffix ESPHome accepts, mapped to its canonical
 *  picker unit. Mirrors `cv.time_period_str_unit`'s `unit_to_kwarg`. */
const TIME_PERIOD_UNIT_ALIASES: Record<string, TimePeriodUnit> = {
  us: "us",
  µs: "us",
  microseconds: "us",
  ms: "ms",
  milliseconds: "ms",
  s: "s",
  sec: "s",
  seconds: "s",
  min: "min",
  minutes: "min",
  h: "h",
  hours: "h",
  d: "d",
  days: "d",
};

// The trailing `$` forces a full match, so the alternation captures the
// whole suffix (`seconds`, not just `s`) regardless of key order.
const _UNIT_PATTERN = Object.keys(TIME_PERIOD_UNIT_ALIASES)
  .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

// Optional whitespace between number and unit, matching ESPHome's regex.
const TIME_PERIOD_PARSE_RE = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(${_UNIT_PATTERN})?$`);
const TIME_PERIOD_SCALAR_RE = new RegExp(`^\\d+(?:\\.\\d+)?\\s*(?:${_UNIT_PATTERN})$`);

/** Detect a time-period scalar shorthand (`50ms`, `1sec`). Requires an
 *  explicit unit so bare numbers like `delta: 0.5` don't false-positive. */
export function looksLikeTimePeriodScalar(raw: unknown): boolean {
  return typeof raw === "string" && TIME_PERIOD_SCALAR_RE.test(raw.trim());
}

/** Split a time-period scalar into its numeric value and canonical unit.
 *  ESPHome rejects a number with no unit ("Did you mean '5s'?"), so a bare
 *  number is `unitless`: its `unit` is only the seconds a picker may start
 *  from, not what the value means. A compound (`1h30s`) or unrecognised
 *  form surfaces verbatim with `parseable: false`. */
export function parseTimePeriodScalar(raw: unknown): {
  value: string;
  unit: TimePeriodUnit;
  parseable: boolean;
  unitless: boolean;
} {
  if (raw === undefined || raw === null || raw === "") {
    return { value: "", unit: "s", parseable: true, unitless: false };
  }
  const text = String(raw).trim();
  const m = text.match(TIME_PERIOD_PARSE_RE);
  if (m) {
    const [, num, suf] = m;
    return {
      value: num,
      unit: suf ? TIME_PERIOD_UNIT_ALIASES[suf] : "s",
      parseable: true,
      unitless: !suf,
    };
  }
  return { value: text, unit: "s", parseable: false, unitless: false };
}

/** Combine a value and canonical unit into the YAML string form; empty
 *  value yields `""` so the caller can drop the field. */
export function serializeTimePeriod(value: string, unit: TimePeriodUnit): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  return `${trimmed}${unit}`;
}

/** Keys of a time period's mapping form (`cv.time_period_dict`), which
 *  takes the long unit names only. */
const DURATION_MAPPING_UNITS: Record<string, TimePeriodUnit> = {
  microseconds: "us",
  milliseconds: "ms",
  seconds: "s",
  minutes: "min",
  hours: "h",
  days: "d",
};

/** The scalar a time period's mapping form (`{seconds: 2}`) is equivalent
 *  to (`"2s"`). Only a single-unit mapping fits one picker; a multi-unit one
 *  (`{minutes: 1, seconds: 30}`) or any other shape is `null`. */
export function durationMappingAsScalar(raw: unknown): string | null {
  if (!isPlainObject(raw)) return null;
  const keys = Object.keys(raw);
  if (
    keys.length !== 1 ||
    !Object.prototype.hasOwnProperty.call(DURATION_MAPPING_UNITS, keys[0])
  ) {
    return null;
  }
  const amount = raw[keys[0]];
  if (typeof amount !== "number" && typeof amount !== "string") return null;
  const scalar = `${String(amount).trim()}${DURATION_MAPPING_UNITS[keys[0]]}`;
  return looksLikeTimePeriodScalar(scalar) ? scalar : null;
}
