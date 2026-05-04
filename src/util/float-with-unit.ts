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
 * The unit match prefers the longest matching option so `"mHz"` doesn't
 * lose its `m` prefix to a shorter `"Hz"` option earlier in the list.
 */
export function parseFloatWithUnit(
  raw: unknown,
  unitOptions: readonly string[],
): FloatWithUnit {
  const fallbackUnit = unitOptions[0] ?? "";
  if (raw === null || raw === undefined || raw === "") {
    return { value: null, unit: fallbackUnit };
  }
  if (typeof raw === "number") {
    return { value: Number.isFinite(raw) ? raw : null, unit: fallbackUnit };
  }
  const text = String(raw).trim();
  if (text === "") return { value: null, unit: fallbackUnit };
  // Sort options longest-first so a value like "50mHz" matches "mHz"
  // rather than the shorter "Hz" option that appears earlier in the
  // canonical-prefix list. Stable for equal lengths.
  const sortedOptions = [...unitOptions].sort((a, b) => b.length - a.length);
  for (const option of sortedOptions) {
    if (option && text.endsWith(option)) {
      const numericPart = text.slice(0, -option.length).trim();
      const parsed = numericPart === "" ? null : Number(numericPart);
      return {
        value: parsed === null || Number.isNaN(parsed) ? null : parsed,
        unit: option,
      };
    }
  }
  // No unit suffix recognised — treat the whole thing as a bare number.
  const parsed = Number(text);
  return {
    value: Number.isFinite(parsed) ? parsed : null,
    unit: fallbackUnit,
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
  unitOptions: readonly string[],
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
  unitOptions: readonly string[],
): string {
  if (defaultValue !== null && defaultValue !== undefined) {
    const parsed = parseFloatWithUnit(defaultValue, unitOptions);
    if (parsed.unit) return parsed.unit;
  }
  return unitOptions[0] ?? "";
}
