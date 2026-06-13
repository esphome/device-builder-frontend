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
 */

/** Canonical units the time-period / delay pickers offer, least to
 *  most coarse. */
export const TIME_PERIOD_UNITS = ["us", "ms", "s", "min", "h", "d"] as const;
export type TimePeriodUnit = (typeof TIME_PERIOD_UNITS)[number];

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
 *  A bare number is seconds (ESPHome's default); a compound (`1h30s`) or
 *  unrecognised form surfaces verbatim with `parseable: false`. */
export function parseTimePeriodScalar(raw: unknown): {
  value: string;
  unit: TimePeriodUnit;
  parseable: boolean;
} {
  if (raw === undefined || raw === null || raw === "") {
    return { value: "", unit: "s", parseable: true };
  }
  const text = String(raw).trim();
  const m = text.match(TIME_PERIOD_PARSE_RE);
  if (m) {
    const [, num, suf] = m;
    return {
      value: num,
      unit: suf ? TIME_PERIOD_UNIT_ALIASES[suf] : "s",
      parseable: true,
    };
  }
  return { value: text, unit: "s", parseable: false };
}

/** Combine a value and canonical unit into the YAML string form; empty
 *  value yields `""` so the caller can drop the field. */
export function serializeTimePeriod(value: string, unit: TimePeriodUnit): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  return `${trimmed}${unit}`;
}
