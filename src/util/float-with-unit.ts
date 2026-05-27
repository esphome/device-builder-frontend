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
  const text = raw === null || raw === undefined ? "" : String(raw).trim();
  if (text === "") return { value: null, unit: fallbackUnit };

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
