/**
 * Parse and serialize FLOAT_WITH_UNIT entry values.
 *
 * The YAML shape is a single string `"<value><unit>"` (e.g.
 * `"50kHz"`, `"3.3V"`, `"-40°C"`); the picker UI treats the two halves
 * separately. These helpers convert between the two representations.
 *
 * Whitespace between the number and the unit is tolerated on parse but
 * never produced on serialize — esphome accepts both `"50kHz"` and
 * `"50 kHz"` but the canonical form drops the space, and we want
 * round-tripping a value the user didn't touch to be a no-op.
 */

export interface FloatWithUnit {
  value: number | null;
  unit: string;
}

// ESPHome accepts textual spellings for some units whose unit_options carry a
// symbol (resistance: 'Ohm' / 'OHM' for Ω; temperature: '21C', '70F', '21° C'
// for the degree forms). Keyed by the canonical base symbol (unit_options[0]);
// each matched spelling is folded onto its symbol before matching, so
// '5.6kOhm' lands on the kΩ option and '21C' on °C. Plurals follow upstream:
// resistance rejects 'Ohms' so that pattern stays singular, while current /
// voltage / data size accept 'amps' / 'Volts' / 'bytes' and fold them. The
// temperature patterns are case-sensitive: ESPHome parses a trailing
// lowercase 'c' as the centi metric prefix ('21c' is 0.21 °C), never a degree.
// The full spelling inventory mirrors esphome/config_validation.py's
// float_with_unit alternations and validate_bytes; symbol-only lists
// (°/deg, dB/dBm, FPS/Hz, bar) already match case-insensitively without help.
const UNIT_SPELLING_ALIASES: Record<string, readonly (readonly [RegExp, string])[]> = {
  Ω: [[/ohm$/i, "Ω"]],
  "°C": [
    [/(?:°\s*C|(?<!°)C|°)$/, "°C"],
    [/(?:°\s*F|(?<!°)F)$/, "°F"],
    [/°\s*K$/, "K"],
  ],
  mireds: [[/Kelvin$/, "K"]],
  A: [[/(?:amp|ampere)s?$/i, "A"]],
  V: [[/volts?$/i, "V"]],
  bps: [[/bits?\/s$/, "bps"]],
  B: [[/(?:bytes?|[Bb]s|b)$/, "B"]],
};

/**
 * Parse a raw value into number + unit.
 *
 * Accepts:
 *  - `"50kHz"`, `"50 kHz"`, `"50"`, `""` (string forms from YAML)
 *  - `50` (a bare number; happens when a previous renderer or the
 *    catalog default is plain numeric — pair with `unitOptions[0]`)
 *
 * `unitOptions` is the entry's `unit_options` list; the first entry
 * is the canonical unit and is used as the default when the input has
 * no unit suffix. When `unitOptions` is empty we fall back to `""`.
 *
 * Matching mirrors ESPHome's ``cv.float_with_unit`` regex
 * (``config_validation.py``): the base unit is matched
 * case-insensitively (``cv.frequency`` accepts ``Hz|HZ|hz``) but the
 * SI prefix is significant (``m`` = milli, ``M`` = mega — different
 * entries in ``METRIC_SUFFIXES``). For an ambiguous case-insensitive
 * match — e.g. ``"433.92Mhz"`` against options ``mHz`` and ``MHz`` —
 * each option is scored by the longest leading run of characters
 * whose case matches the input verbatim, and the highest-scoring
 * option wins. So ``"Mhz"`` → ``MHz`` (M matches → score 1 beats
 * ``mHz``'s 0) and ``"mhz"`` → ``mHz`` (m matches → score 1 beats
 * ``MHz``'s 0). The returned ``unit`` is always the canonical-cased
 * option from ``unitOptions``, so a save round-trip normalises the
 * user's casing to the ESPHome-canonical form. Issue #213.
 */
export function parseFloatWithUnit(
  raw: unknown,
  unitOptions: readonly string[]
): FloatWithUnit {
  const fallbackUnit = unitOptions[0] ?? "";
  // Funnel everything through `String().trim()` so the rest of the
  // function only deals with strings. NaN/Infinity numbers stringify
  // to "NaN"/"Infinity" which `Number()` round-trips back to non-finite
  // — caught by the final `Number.isFinite` guard.
  const trimmed = raw === null || raw === undefined ? "" : String(raw).trim();
  if (trimmed === "") return { value: null, unit: fallbackUnit };

  // Fold textual unit spellings onto their symbols when this picker uses
  // them, so '5.6kOhm' matches the kΩ option and '21C' matches °C (see
  // UNIT_SPELLING_ALIASES).
  let text = trimmed;
  for (const [pattern, symbol] of UNIT_SPELLING_ALIASES[fallbackUnit] ?? []) {
    text = text.replace(pattern, symbol);
  }
  const lowerText = text.toLowerCase();
  let match: string | undefined;
  let bestScore = -1;
  let bestLength = -1;
  for (const option of unitOptions) {
    if (option === "") continue;
    if (!lowerText.endsWith(option.toLowerCase())) continue;
    // Score: count of leading characters whose case matches the
    // input's corresponding suffix character. Higher score → the
    // option's prefix-case lines up with what the user typed, which
    // is the disambiguator for ``mHz`` (milli) vs ``MHz`` (mega)
    // when the user's input is case-folded (``Mhz`` / ``mhz``).
    const suffix = text.slice(-option.length);
    let score = 0;
    for (let i = 0; i < option.length; i++) {
      if (suffix[i] !== option[i]) break;
      score++;
    }
    // Prefer higher score; tie-break on length (longer match
    // captures more of the user's input — ``"50mHz"`` should match
    // ``mHz`` over ``Hz`` so the ``m`` prefix isn't stranded as
    // part of the numeric portion).
    if (score > bestScore || (score === bestScore && option.length > bestLength)) {
      match = option;
      bestScore = score;
      bestLength = option.length;
    }
  }

  const [numericText, unit] = match
    ? [text.slice(0, -match.length).trim(), match]
    : [text, fallbackUnit];
  const value = numericText === "" ? null : Number(numericText);
  return {
    value: typeof value === "number" && Number.isFinite(value) ? value : null,
    unit,
  };
}

/**
 * Combine number + unit into the YAML string form. Returns `""` when
 * `value` is null so the caller can drop the field from the payload
 * (matching how empty optional entries are stripped today).
 */
export function serializeFloatWithUnit(parsed: FloatWithUnit): string {
  if (parsed.value === null) return "";
  return `${parsed.value}${parsed.unit}`;
}

/**
 * Format a base-unit value with the largest listed unit dividing it
 * cleanly: 15000 with Hz-based options yields '15kHz'. Falls back to
 * the base unit so the result always validates against the options.
 */
export function formatInBestUnit(
  baseValue: number,
  unitOptions: readonly string[]
): string {
  const base = unitOptions[0] ?? "";
  let bestUnit = base;
  let bestMult = 1;
  for (const option of unitOptions) {
    if (option === base || !option.endsWith(base)) continue;
    const prefix = option.slice(0, option.length - base.length);
    if (!Object.prototype.hasOwnProperty.call(METRIC_PREFIX_MULTIPLIERS, prefix))
      continue;
    const mult = METRIC_PREFIX_MULTIPLIERS[prefix];
    if (mult > bestMult && baseValue % mult === 0) {
      bestMult = mult;
      bestUnit = option;
    }
  }
  return `${baseValue / bestMult}${bestUnit}`;
}

/**
 * Parse to the base (first) unit's scale: '50kHz' with Hz-based options
 * yields 50000. Null when valueless or the unit isn't metric-prefixed.
 */
export function floatWithUnitToBase(
  raw: unknown,
  unitOptions: readonly string[]
): number | null {
  const { value, unit } = parseFloatWithUnit(raw, unitOptions);
  if (value === null) return null;
  const base = unitOptions[0] ?? "";
  if (unit === base) return value;
  if (!unit.endsWith(base)) return null;
  const prefix = unit.slice(0, unit.length - base.length);
  if (!Object.prototype.hasOwnProperty.call(METRIC_PREFIX_MULTIPLIERS, prefix)) {
    return null;
  }
  return value * METRIC_PREFIX_MULTIPLIERS[prefix];
}

/**
 * Compute the numeric placeholder shown in the FLOAT_WITH_UNIT
 * field's number input from the catalog's `default_value`.
 *
 * The catalog's default for an `i2c.frequency` entry is the YAML
 * string the user would type (`"50kHz"`); the number input wants
 * just the magnitude (`"50"`). Strip the unit so the placeholder
 * reads naturally next to the unit picker — otherwise the user
 * sees `"50kHz"` echoed inside a number input, which is misleading
 * (the input doesn't accept letters).
 *
 * The unit half of the default seeds the picker via
 * `defaultUnitForFloatWithUnit` so a user who never touches the
 * field still sees the right unit pre-selected.
 */
export function placeholderForFloatWithUnit(
  defaultValue: unknown,
  unitOptions: readonly string[]
): string {
  if (defaultValue === null || defaultValue === undefined) return "";
  const parsed = parseFloatWithUnit(defaultValue, unitOptions);
  if (parsed.value === null) return "";
  return String(parsed.value);
}

/**
 * Pick the unit shown in the picker when the field has no current
 * value. Falls back to the catalog default's unit, then to the
 * canonical (first) option, then to empty.
 */
export function defaultUnitForFloatWithUnit(
  defaultValue: unknown,
  unitOptions: readonly string[]
): string {
  if (defaultValue !== null && defaultValue !== undefined) {
    const parsed = parseFloatWithUnit(defaultValue, unitOptions);
    if (parsed.unit) return parsed.unit;
  }
  return unitOptions[0] ?? "";
}

/**
 * Compute the unit shown in the picker, layering four sources in
 * priority order:
 *
 * 1. The current YAML value's unit (e.g. `"50kHz"` → `"kHz"`),
 *    when the field has a value.
 * 2. The user's transient unit pick — they changed the picker on
 *    an empty field; serializing `{value:null, unit}` would emit
 *    `""` and the next render's default-fallback would snap the
 *    picker back to canonical, so the form stashes the choice
 *    out-of-band and reads it here.
 * 3. The unit half of the catalog default.
 * 4. The canonical (first) option, then empty.
 *
 * Pure for testability — the renderer wires in `getPendingUnit` and
 * `getAt` against the form's state.
 */
export function chooseDisplayUnit(
  rawValue: unknown,
  defaultValue: unknown,
  pendingUnit: string | undefined,
  unitOptions: readonly string[]
): string {
  const canonicalUnit = unitOptions[0] ?? "";
  const hasValue = rawValue !== null && rawValue !== undefined && rawValue !== "";
  if (hasValue) {
    return parseFloatWithUnit(rawValue, unitOptions).unit || canonicalUnit;
  }
  return pendingUnit ?? defaultUnitForFloatWithUnit(defaultValue, unitOptions);
}

// SI prefixes the metric pickers use, with multipliers, for judging which
// prefixed options sit at a field's scale. 'µ' is the canonical micro form.
const METRIC_PREFIX_MULTIPLIERS: Record<string, number> = {
  "": 1,
  n: 1e-9,
  µ: 1e-6,
  m: 1e-3,
  k: 1e3,
  M: 1e6,
  G: 1e9,
};

/**
 * Narrow `unitOptions` to prefixes at the field's `range` scale, always keeping
 * `mustKeep` units. Only metric-prefixed lists are trimmed; fixed lists and
 * rangeless fields pass through. Display-only: callers parse against the full
 * list, so a trimmed unit a value already uses is never stranded.
 */
export function visibleUnitOptions(
  unitOptions: readonly string[],
  range: readonly [number, number] | null,
  mustKeep: readonly string[]
): string[] {
  const all = [...unitOptions];
  if (!range || all.length <= 1) return all;
  const base = all[0];
  const prefixOf = (option: string): string | null => {
    if (option === base) return "";
    if (!option.endsWith(base)) return null;
    const prefix = option.slice(0, option.length - base.length);
    // own-key check, not `in`, so inherited keys (toString/constructor) can't
    // masquerade as a known prefix and mis-trim a non-metric unit.
    return Object.prototype.hasOwnProperty.call(METRIC_PREFIX_MULTIPLIERS, prefix)
      ? prefix
      : null;
  };
  // Only trim genuinely metric-prefixed lists.
  if (!all.every((option) => prefixOf(option) !== null)) return all;
  const [min, max] = range;
  const keep = new Set(mustKeep);
  const result = all.filter((option) => {
    if (keep.has(option)) return true;
    const mult = METRIC_PREFIX_MULTIPLIERS[prefixOf(option) as string];
    return 0.1 * mult <= max && 1000 * mult >= min;
  });
  return result.length ? result : all;
}
