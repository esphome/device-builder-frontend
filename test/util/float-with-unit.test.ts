import { describe, expect, it } from "vitest";
import {
  chooseDisplayUnit,
  defaultUnitForFloatWithUnit,
  parseFloatWithUnit,
  placeholderForFloatWithUnit,
  serializeFloatWithUnit,
} from "../../src/util/float-with-unit.js";

const FREQUENCY_UNITS = ["Hz", "mHz", "kHz", "MHz", "GHz"] as const;
const TEMPERATURE_UNITS = ["°C", "°F", "K"] as const;

describe("parseFloatWithUnit", () => {
  it("splits the canonical case", () => {
    expect(parseFloatWithUnit("50kHz", FREQUENCY_UNITS)).toEqual({
      value: 50,
      unit: "kHz",
    });
  });

  it("tolerates whitespace between number and unit", () => {
    expect(parseFloatWithUnit("50 kHz", FREQUENCY_UNITS)).toEqual({
      value: 50,
      unit: "kHz",
    });
  });

  it("handles non-ASCII unit characters", () => {
    expect(parseFloatWithUnit("-40°C", TEMPERATURE_UNITS)).toEqual({
      value: -40,
      unit: "°C",
    });
  });

  it("prefers the longest matching unit suffix", () => {
    // "mHz" must not lose its "m" prefix to a shorter "Hz" option.
    expect(parseFloatWithUnit("0.5mHz", FREQUENCY_UNITS)).toEqual({
      value: 0.5,
      unit: "mHz",
    });
  });

  it("falls back to the canonical unit on bare numbers", () => {
    expect(parseFloatWithUnit("50", FREQUENCY_UNITS)).toEqual({
      value: 50,
      unit: "Hz",
    });
    expect(parseFloatWithUnit(50, FREQUENCY_UNITS)).toEqual({
      value: 50,
      unit: "Hz",
    });
  });

  it("returns null value for empty input", () => {
    expect(parseFloatWithUnit("", FREQUENCY_UNITS)).toEqual({
      value: null,
      unit: "Hz",
    });
    expect(parseFloatWithUnit(null, FREQUENCY_UNITS)).toEqual({
      value: null,
      unit: "Hz",
    });
    expect(parseFloatWithUnit(undefined, FREQUENCY_UNITS)).toEqual({
      value: null,
      unit: "Hz",
    });
  });

  it("returns null value when the numeric portion is non-numeric", () => {
    expect(parseFloatWithUnit("abc kHz", FREQUENCY_UNITS)).toEqual({
      value: null,
      unit: "kHz",
    });
  });

  it("falls back to empty unit when unit_options is empty", () => {
    expect(parseFloatWithUnit("42", [])).toEqual({ value: 42, unit: "" });
  });

  it("rejects non-finite numeric inputs", () => {
    expect(parseFloatWithUnit(Number.NaN, FREQUENCY_UNITS)).toEqual({
      value: null,
      unit: "Hz",
    });
    expect(parseFloatWithUnit(Number.POSITIVE_INFINITY, FREQUENCY_UNITS)).toEqual({
      value: null,
      unit: "Hz",
    });
  });

  it("treats whitespace-only strings as empty", () => {
    expect(parseFloatWithUnit("   ", FREQUENCY_UNITS)).toEqual({
      value: null,
      unit: "Hz",
    });
  });

  it("accepts scientific notation", () => {
    expect(parseFloatWithUnit("1e3kHz", FREQUENCY_UNITS)).toEqual({
      value: 1000,
      unit: "kHz",
    });
  });

  it("returns null for unparseable non-numeric / object inputs", () => {
    expect(parseFloatWithUnit({}, FREQUENCY_UNITS)).toEqual({
      value: null,
      unit: "Hz",
    });
  });

  it("round-trips through serialize for typical inputs", () => {
    for (const raw of ["50kHz", "0.5mHz", "1000Hz", "-2GHz"]) {
      expect(serializeFloatWithUnit(parseFloatWithUnit(raw, FREQUENCY_UNITS)))
        .toBe(raw);
    }
  });

  // ESPHome's ``cv.frequency`` accepts the base ``Hz`` suffix
  // case-insensitively (``Hz|HZ|hz``); the SI prefix (``m`` /
  // ``M`` / ``k`` / ``G`` / …) IS case-significant per
  // ``METRIC_SUFFIXES`` — ``m`` is milli, ``M`` is mega. The parser
  // mirrors that: case-fold the base, preserve prefix case
  // disambiguation when the input is case-mixed. Issue #213.
  describe("case-variant base units", () => {
    it("normalises lowercase 'hz' to canonical 'Hz'", () => {
      expect(parseFloatWithUnit("60hz", FREQUENCY_UNITS)).toEqual({
        value: 60,
        unit: "Hz",
      });
    });

    it("normalises uppercase 'HZ' to canonical 'Hz'", () => {
      expect(parseFloatWithUnit("60HZ", FREQUENCY_UNITS)).toEqual({
        value: 60,
        unit: "Hz",
      });
    });

    it("'Mhz' (capital prefix, lowercase base) → 'MHz' (mega)", () => {
      // The trigger from #213: user typed `433.92Mhz` and saw the
      // form snap to canonical `Hz` (zero) instead of recognising
      // the mega-Hz value. Capital prefix M wins the score over
      // lowercase prefix m.
      expect(parseFloatWithUnit("433.92Mhz", FREQUENCY_UNITS)).toEqual({
        value: 433.92,
        unit: "MHz",
      });
    });

    it("'MHZ' (capital prefix + uppercase base) → 'MHz' (mega)", () => {
      expect(parseFloatWithUnit("433.92MHZ", FREQUENCY_UNITS)).toEqual({
        value: 433.92,
        unit: "MHz",
      });
    });

    it("'mhz' (lowercase prefix + lowercase base) → 'mHz' (milli)", () => {
      // ESPHome's METRIC_SUFFIXES distinguishes ``m`` (milli) from
      // ``M`` (mega), so a lowercase prefix means milli regardless
      // of the base unit's case. The score-based tiebreak picks
      // ``mHz`` (m matches case → 1) over ``MHz`` (m≠M → 0). A
      // user who meant mega should have typed ``Mhz`` / ``MHz``;
      // we faithfully report what ESPHome would parse.
      expect(parseFloatWithUnit("433.92mhz", FREQUENCY_UNITS)).toEqual({
        value: 433.92,
        unit: "mHz",
      });
    });

    it("normalises lowercase 'khz' to canonical 'kHz'", () => {
      expect(parseFloatWithUnit("50khz", FREQUENCY_UNITS)).toEqual({
        value: 50,
        unit: "kHz",
      });
    });

    it("normalises lowercase 'ghz' to canonical 'GHz'", () => {
      // Lowercase 'g' is NOT in ESPHome's METRIC_SUFFIXES (only G
      // for giga). Both ``GHz`` and ``Hz`` match ``"2ghz"`` case-
      // insensitively (both lowercase forms end the input), and
      // both score 0 case-sensitive leading-match characters
      // (``2`` ≠ ``G``, ``h`` ≠ ``H``). The length tie-break picks
      // ``GHz`` (3 chars > 2) so the user's ``g`` prefix isn't
      // stranded as part of the numeric portion. Round-trips
      // through save as canonical ``GHz``.
      expect(parseFloatWithUnit("2ghz", FREQUENCY_UNITS)).toEqual({
        value: 2,
        unit: "GHz",
      });
    });

    it("preserves the user's case when it already matches an option", () => {
      // Sanity check: case-sensitive matches still win when no
      // case-variant ambiguity exists.
      expect(parseFloatWithUnit("0.5mHz", FREQUENCY_UNITS)).toEqual({
        value: 0.5,
        unit: "mHz",
      });
      expect(parseFloatWithUnit("50MHz", FREQUENCY_UNITS)).toEqual({
        value: 50,
        unit: "MHz",
      });
    });

    it("handles case-variant resistance suffixes", () => {
      // Scope check: the bug is in ``cv.float_with_unit`` itself,
      // not specific to ``cv.frequency``. Pin that resistance
      // (which takes ``Ω|ohm|Ohm|OHM`` and various SI prefixes in
      // its ESPHome regex) gets the same case-insensitive
      // treatment for the BASE unit. The user can type the base
      // in any case (``ohm``, ``Ohm``, ``OHM``) and the parser
      // picks the right SI-prefixed option, normalising to the
      // canonical-cased option on round-trip.
      const resistanceUnits = ["Ohm", "kOhm", "MOhm"] as const;
      // All-lowercase: ``k`` matches case (score 1) > ``Ohm``'s
      // ``o`` ≠ ``O`` (score 0). Length tie-break would also pick
      // ``kOhm`` over the bare ``Ohm`` if scores tied.
      expect(parseFloatWithUnit("4.7kohm", resistanceUnits)).toEqual({
        value: 4.7,
        unit: "kOhm",
      });
      // Lowercase prefix + uppercase base: ``kOhm`` scores 2
      // (k=k, O=O) vs ``Ohm``'s 1 (O=O, h≠H), so the SI prefix
      // is preserved correctly even though the user uppercased
      // the base.
      expect(parseFloatWithUnit("4.7kOHM", resistanceUnits)).toEqual({
        value: 4.7,
        unit: "kOhm",
      });
    });

    it("save round-trip normalises case-variant input to canonical", () => {
      // Round-trip via parse → serialize. The user's lowercase
      // ``Mhz`` becomes the canonical ``MHz`` on save — same shape
      // ESPHome's emitter produces, so a YAML diff after save is
      // limited to the casing fix.
      const parsed = parseFloatWithUnit("433.92Mhz", FREQUENCY_UNITS);
      expect(serializeFloatWithUnit(parsed)).toBe("433.92MHz");
    });
  });
});

describe("placeholderForFloatWithUnit", () => {
  it("strips the unit from a unit-suffixed default", () => {
    // The catalog's default for cv.frequency entries is the literal
    // YAML string the user would type ("50kHz"). The number input
    // wants just the magnitude — the unit lives in the picker next
    // to it, so the placeholder must drop the suffix or the user
    // sees confusing text in a number-only input.
    expect(placeholderForFloatWithUnit("50kHz", FREQUENCY_UNITS)).toBe("50");
    expect(placeholderForFloatWithUnit("3.3V", ["V", "mV", "kV"])).toBe("3.3");
  });

  it("returns the bare number form when default has no unit", () => {
    expect(placeholderForFloatWithUnit(60, FREQUENCY_UNITS)).toBe("60");
    expect(placeholderForFloatWithUnit("60", FREQUENCY_UNITS)).toBe("60");
  });

  it("returns empty for null/undefined defaults", () => {
    expect(placeholderForFloatWithUnit(null, FREQUENCY_UNITS)).toBe("");
    expect(placeholderForFloatWithUnit(undefined, FREQUENCY_UNITS)).toBe("");
  });

  it("returns empty when the default has no parseable numeric part", () => {
    expect(placeholderForFloatWithUnit("kHz", FREQUENCY_UNITS)).toBe("");
  });
});

describe("defaultUnitForFloatWithUnit", () => {
  it("uses the unit from the catalog default when present", () => {
    expect(defaultUnitForFloatWithUnit("50kHz", FREQUENCY_UNITS)).toBe("kHz");
    expect(defaultUnitForFloatWithUnit("-40°C", TEMPERATURE_UNITS)).toBe("°C");
  });

  it("falls back to the canonical option when default has no unit", () => {
    expect(defaultUnitForFloatWithUnit(60, FREQUENCY_UNITS)).toBe("Hz");
    expect(defaultUnitForFloatWithUnit("", FREQUENCY_UNITS)).toBe("Hz");
  });

  it("falls back to the canonical option when default is null", () => {
    expect(defaultUnitForFloatWithUnit(null, FREQUENCY_UNITS)).toBe("Hz");
    expect(defaultUnitForFloatWithUnit(undefined, FREQUENCY_UNITS)).toBe("Hz");
  });

  it("returns empty when unit_options is empty", () => {
    expect(defaultUnitForFloatWithUnit(null, [])).toBe("");
    expect(defaultUnitForFloatWithUnit(50, [])).toBe("");
  });
});

describe("chooseDisplayUnit", () => {
  it("uses the parsed unit when the value is non-empty", () => {
    expect(
      chooseDisplayUnit("50kHz", "10MHz", undefined, FREQUENCY_UNITS),
    ).toBe("kHz");
  });

  it("ignores the pending unit when the value is non-empty", () => {
    // Once the user has typed a number, the picker reflects the
    // value's unit — pending state from before they typed is
    // superseded.
    expect(
      chooseDisplayUnit("50kHz", "10MHz", "GHz", FREQUENCY_UNITS),
    ).toBe("kHz");
  });

  it("uses the pending unit when the value is empty", () => {
    // The user picked a unit on an empty field; the picker must
    // reflect that choice on the next render — without this the
    // picker snaps back to the catalog default and the user's
    // pick is lost on every keystroke that re-renders.
    expect(chooseDisplayUnit("", "50kHz", "GHz", FREQUENCY_UNITS)).toBe("GHz");
    expect(chooseDisplayUnit(null, null, "MHz", FREQUENCY_UNITS)).toBe("MHz");
  });

  it("falls back to the catalog default's unit when no pending pick", () => {
    expect(
      chooseDisplayUnit("", "50kHz", undefined, FREQUENCY_UNITS),
    ).toBe("kHz");
  });

  it("falls back to the canonical option when nothing else is set", () => {
    expect(
      chooseDisplayUnit("", null, undefined, FREQUENCY_UNITS),
    ).toBe("Hz");
  });

  it("returns empty when unit_options is empty", () => {
    expect(chooseDisplayUnit("", null, undefined, [])).toBe("");
  });
});

describe("serializeFloatWithUnit", () => {
  it("concatenates value and unit without separator", () => {
    expect(
      serializeFloatWithUnit({ value: 50, unit: "kHz" }),
    ).toBe("50kHz");
  });

  it("returns empty string for null value", () => {
    expect(serializeFloatWithUnit({ value: null, unit: "kHz" })).toBe("");
  });

  it("round-trips through parse", () => {
    const parsed = parseFloatWithUnit("3.3V", ["V", "mV", "kV"]);
    expect(serializeFloatWithUnit(parsed)).toBe("3.3V");
  });
});
