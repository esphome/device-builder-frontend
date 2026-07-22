import { describe, expect, it } from "vitest";
import type { ConfigValueOption } from "../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import {
  clearPathErrors,
  getDeviceNameWarning,
  isEntryVisible,
  nearCanonicalOption,
  platformSupported,
  validateDeviceName,
  validateEntries,
  validateEntry,
} from "../../src/util/config-validation.js";
import { YamlRawValue } from "../../src/util/yaml-serialize.js";
import { makeConfigEntry as makeEntry } from "./_make-config-entry.js";

describe("validateDeviceName", () => {
  it("accepts valid slug", () => {
    expect(validateDeviceName("my-esp-32")).toBeNull();
  });

  it("rejects empty names", () => {
    expect(validateDeviceName("")?.code).toBe("validation.required");
    expect(validateDeviceName("   ")?.code).toBe("validation.required");
  });

  it("rejects uppercase characters", () => {
    expect(validateDeviceName("MyDevice")?.code).toBe("validation.invalid_device_name");
  });

  it("accepts underscores (esphome rename allows them)", () => {
    /* Plenty of existing configs use ``my_device`` style; rejecting
       them here would make those devices un-renamable from the
       dashboard. The ``getDeviceNameWarning`` companion flags them
       as a soft mDNS-hostname warning instead. */
    expect(validateDeviceName("my_device")).toBeNull();
  });

  it("accepts leading/trailing hyphen (esphome rename allows them)", () => {
    expect(validateDeviceName("-foo")).toBeNull();
    expect(validateDeviceName("foo-")).toBeNull();
  });

  it("rejects names over 63 chars", () => {
    expect(validateDeviceName("a".repeat(64))?.code).toBe("validation.max_length");
  });
});

describe("getDeviceNameWarning", () => {
  it("warns about underscores (mDNS hostname concern)", () => {
    expect(getDeviceNameWarning("my_device")?.code).toBe(
      "validation.device_name_underscore"
    );
  });

  it("warns about leading or trailing hyphens", () => {
    /* RFC 952/1123 forbids edge hyphens in DNS labels, so they
       have the same mDNS-resolution risk as underscores. */
    expect(getDeviceNameWarning("-foo")?.code).toBe("validation.device_name_edge_hyphen");
    expect(getDeviceNameWarning("foo-")?.code).toBe("validation.device_name_edge_hyphen");
  });

  it("returns null for clean hyphenated names", () => {
    expect(getDeviceNameWarning("my-device")).toBeNull();
    expect(getDeviceNameWarning("device42")).toBeNull();
  });
});

describe("isEntryVisible depends_on resolution", () => {
  const gated = makeEntry({
    key: "sram1_as_iram",
    depends_on: "variant",
    depends_on_value_any: ["esp32", "ESP32"],
  });

  it("resolves depends_on against a sibling in the local scope", () => {
    expect(isEntryVisible(gated, { variant: "esp32" })).toBe(true);
    expect(isEntryVisible(gated, { variant: "esp32c2" })).toBe(false);
  });

  it("falls back to rootValues when the dependency isn't a local sibling", () => {
    // sram1_as_iram is nested under framework.advanced; `variant` lives at
    // the component root, so the local (advanced-group) scope lacks it.
    expect(isEntryVisible(gated, {}, undefined, undefined, { variant: "esp32" })).toBe(
      true
    );
    expect(isEntryVisible(gated, {}, undefined, undefined, { variant: "ESP32" })).toBe(
      true
    );
    expect(isEntryVisible(gated, {}, undefined, undefined, { variant: "esp32c2" })).toBe(
      false
    );
  });

  it("prefers a local sibling over rootValues when both carry the key", () => {
    expect(
      isEntryVisible(gated, { variant: "esp32c2" }, undefined, undefined, {
        variant: "esp32",
      })
    ).toBe(false);
  });

  it("without rootValues, an unresolved cross-scope dependency hides the entry", () => {
    expect(isEntryVisible(gated, {})).toBe(false);
  });
});

describe("isEntryVisible depends_on default fallback", () => {
  // The spi shape from #1972: `type` defaults to "single" and YAML omits
  // defaulted fields, so miso_pin/mosi_pin must stay visible with `type` unset.
  const type = makeEntry({ key: "type", default_value: "single" });
  const misoPin = makeEntry({
    key: "miso_pin",
    depends_on: "type",
    depends_on_value_any: ["single"],
  });
  const dataPins = makeEntry({
    key: "data_pins",
    depends_on: "type",
    depends_on_value_any: ["quad", "octal"],
  });
  const siblings = [type, misoPin, dataPins];

  it("an unset dependency reads as its sibling's default_value", () => {
    expect(isEntryVisible(misoPin, {}, undefined, undefined, undefined, siblings)).toBe(
      true
    );
    expect(isEntryVisible(dataPins, {}, undefined, undefined, undefined, siblings)).toBe(
      false
    );
  });

  it("an explicit value beats the default", () => {
    const values = { type: "quad" };
    expect(
      isEntryVisible(misoPin, values, undefined, undefined, undefined, siblings)
    ).toBe(false);
    expect(
      isEntryVisible(dataPins, values, undefined, undefined, undefined, siblings)
    ).toBe(true);
  });

  it("without siblings an unset dependency hides the entry as before", () => {
    expect(isEntryVisible(misoPin, {})).toBe(false);
  });

  it("a dependency without a default_value still hides the entry", () => {
    const noDefault = [makeEntry({ key: "type" }), misoPin];
    expect(isEntryVisible(misoPin, {}, undefined, undefined, undefined, noDefault)).toBe(
      false
    );
  });
});

describe("nearCanonicalOption", () => {
  const opt = (value: string, label = value): ConfigValueOption => ({ label, value });
  const units = [opt("L"), opt("L/s"), opt("m³")];

  it("suggests the canonical value for a case-only mismatch", () => {
    expect(nearCanonicalOption("l", units)).toBe("L");
    expect(nearCanonicalOption("l/S", units)).toBe("L/s");
  });

  it("returns null when the value exactly matches an option", () => {
    expect(nearCanonicalOption("L", units)).toBeNull();
    expect(nearCanonicalOption("L/s", units)).toBeNull();
  });

  it("returns null for a genuinely custom value", () => {
    expect(nearCanonicalOption("L/min", units)).toBeNull();
  });

  it("matches the first case-insensitive option when several collide", () => {
    expect(nearCanonicalOption("foo", [opt("FOO"), opt("Foo")])).toBe("FOO");
  });

  it("never matches on the label alone", () => {
    expect(nearCanonicalOption("litre", [opt("L", "litre")])).toBeNull();
  });

  it("returns null for empty value or empty/null options", () => {
    expect(nearCanonicalOption("", units)).toBeNull();
    expect(nearCanonicalOption("l", [])).toBeNull();
    expect(nearCanonicalOption("l", null)).toBeNull();
  });
});

describe("validateEntry", () => {
  it("flags required empty field", () => {
    const entry = makeEntry({ required: true });
    expect(validateEntry(entry, "")?.code).toBe("validation.required");
    expect(validateEntry(entry, undefined)?.code).toBe("validation.required");
  });

  it("skips an unset hidden field but validates a set one", () => {
    const entry = makeEntry({ required: true, hidden: true });
    expect(validateEntry(entry, "")).toBeNull();
    const numeric = makeEntry({
      hidden: true,
      type: ConfigEntryType.INTEGER,
      display_format: "hex",
    });
    expect(validateEntry(numeric, "xyz")?.code).toBe("validation.not_a_number");
  });

  it("ignores UNKNOWN (YAML-only) fields even when required", () => {
    // A mapping-or-list union the form renders as the YAML-only notice;
    // it must not block the wizard with an unclearable required error.
    const entry = makeEntry({ required: true, type: ConfigEntryType.UNKNOWN });
    expect(validateEntry(entry, "")).toBeNull();
  });

  it("allows empty optional fields", () => {
    expect(validateEntry(makeEntry({ required: false }), "")).toBeNull();
  });

  it("enforces integer range", () => {
    const entry = makeEntry({ type: ConfigEntryType.INTEGER, range: [1, 10] });
    expect(validateEntry(entry, 0)?.code).toBe("validation.min");
    expect(validateEntry(entry, 11)?.code).toBe("validation.max");
    expect(validateEntry(entry, 5)).toBeNull();
  });

  it("flags non-integer values on INTEGER fields", () => {
    const entry = makeEntry({ type: ConfigEntryType.INTEGER });
    expect(validateEntry(entry, 3.5)?.code).toBe("validation.not_an_integer");
    expect(validateEntry(entry, "abc")?.code).toBe("validation.not_a_number");
  });

  it("accepts decimal or hex on a plain INTEGER field, but not forms cv.int_ rejects", () => {
    const entry = makeEntry({ type: ConfigEntryType.INTEGER });
    expect(validateEntry(entry, "4369")).toBeNull();
    expect(validateEntry(entry, "0x1111")).toBeNull();
    // 1e3 is Number()-valid (1000) but cv.int_ can't parse it — must be flagged.
    expect(validateEntry(entry, "1e3")?.code).toBe("validation.not_an_integer");
  });

  it("range-checks a plain INTEGER field with BigInt so 64-bit decimals stay precise", () => {
    const entry = makeEntry({
      type: ConfigEntryType.INTEGER,
      range: [0, 18446744073709551615],
    });
    // A value Number() would round to the imprecise bound stays distinguishable.
    expect(validateEntry(entry, "18446744073709551615")).toBeNull();
    expect(validateEntry(entry, "-1")?.code).toBe("validation.min");
  });

  it("validates hex-typed INTEGER fields via BigInt (#944 range honesty)", () => {
    // ``Number(String(raw))`` rounds 0xbe030c9794184728 to
    // 0xbe030c9794184800 before the comparison; a precise input would
    // pass an imprecise bound by accident. BigInt routing keeps the
    // comparison exact at the catalog's full cv.hex_uint64_t range.
    const entry = makeEntry({
      type: ConfigEntryType.INTEGER,
      display_format: "hex",
      range: [0, 18446744073709551615],
    });
    expect(validateEntry(entry, "0xbe030c9794184728")).toBeNull();
    expect(validateEntry(entry, "0xffffffffffffffff")).toBeNull();
    expect(validateEntry(entry, "0x76")).toBeNull();
    expect(validateEntry(entry, "abc")?.code).toBe("validation.not_a_number");
  });

  it("enforces hex range bounds when both fit safely", () => {
    // i2c-style hex field with a tight range; pre-#944 behaviour stays
    // intact for the small-range case.
    const entry = makeEntry({
      type: ConfigEntryType.INTEGER,
      display_format: "hex",
      range: [0x08, 0x77],
    });
    expect(validateEntry(entry, "0x07")?.code).toBe("validation.min");
    expect(validateEntry(entry, "0x78")?.code).toBe("validation.max");
    expect(validateEntry(entry, "0x76")).toBeNull();
  });

  it("accepts floats on FLOAT fields", () => {
    const entry = makeEntry({ type: ConfigEntryType.FLOAT });
    expect(validateEntry(entry, 3.5)).toBeNull();
  });

  it("flags non-finite text on FLOAT fields", () => {
    const entry = makeEntry({ type: ConfigEntryType.FLOAT });
    expect(validateEntry(entry, "1e309")?.code).toBe("validation.not_a_number");
    expect(validateEntry(entry, "Infinity")?.code).toBe("validation.not_a_number");
    expect(validateEntry(entry, "1e308")).toBeNull();
  });

  it("validates the numeric portion of FLOAT_WITH_UNIT entries", () => {
    const entry = makeEntry({
      type: ConfigEntryType.FLOAT_WITH_UNIT,
      unit_options: ["Hz", "kHz", "MHz"],
    });
    expect(validateEntry(entry, "50kHz")).toBeNull();
    expect(validateEntry(entry, "3.3 V")?.code).toBe("validation.not_a_number");
    expect(validateEntry(entry, "abckHz")?.code).toBe("validation.not_a_number");
  });

  it("applies range only when FLOAT_WITH_UNIT value is in canonical unit", () => {
    const entry = makeEntry({
      type: ConfigEntryType.FLOAT_WITH_UNIT,
      unit_options: ["Hz", "kHz", "MHz"],
      range: [10, 1_000_000],
    });
    // Canonical unit (Hz) — range bounds apply directly.
    expect(validateEntry(entry, "5Hz")?.code).toBe("validation.min");
    expect(validateEntry(entry, "100Hz")).toBeNull();
    // Non-canonical unit — range bounds skipped (catalog ranges are
    // post-coercion floats relative to the canonical unit).
    expect(validateEntry(entry, "5kHz")).toBeNull();
  });

  it("does not flag empty optional FLOAT_WITH_UNIT entries", () => {
    const entry = makeEntry({
      type: ConfigEntryType.FLOAT_WITH_UNIT,
      required: false,
      unit_options: ["Hz", "kHz"],
    });
    expect(validateEntry(entry, "")).toBeNull();
    expect(validateEntry(entry, undefined)).toBeNull();
  });

  it("never flags a numeric field holding a ${var} substitution (#1391)", () => {
    // A substitution resolves at build time; its value is unknowable here,
    // so it must not surface "Must be a number" on the structured form.
    expect(
      validateEntry(makeEntry({ type: ConfigEntryType.FLOAT }), "${voltage_div}")
    ).toBeNull();
    expect(
      validateEntry(makeEntry({ type: ConfigEntryType.FLOAT }), "$voltage_div")
    ).toBeNull();
    expect(
      validateEntry(makeEntry({ type: ConfigEntryType.INTEGER }), "${count}")
    ).toBeNull();
    expect(
      validateEntry(
        makeEntry({ type: ConfigEntryType.FLOAT_WITH_UNIT, unit_options: ["Ω"] }),
        "${current_res}"
      )
    ).toBeNull();
  });

  it("treats a required field as satisfied when it holds a ${var} (#1391)", () => {
    const entry = makeEntry({ type: ConfigEntryType.FLOAT, required: true });
    expect(validateEntry(entry, "${current_res}")).toBeNull();
  });

  it("does not flag a mid-edit partial substitution as not-a-number (#1391)", () => {
    // While the user is editing ${voltage_div} (e.g. the brace is gone), the
    // value must not surface an error that blocks finishing the edit.
    const entry = makeEntry({ type: ConfigEntryType.FLOAT });
    expect(validateEntry(entry, "${voltage_div")).toBeNull();
    expect(validateEntry(entry, "${")).toBeNull();
  });

  it("still flags numeric junk with a stray or escaped $ (#773 review)", () => {
    // A bare includes("$") bypass would let these through; only real
    // ${var}/$var syntax should suppress the not-a-number error.
    const entry = makeEntry({ type: ConfigEntryType.FLOAT });
    expect(validateEntry(entry, "12$34")?.code).toBe("validation.not_a_number");
    expect(validateEntry(entry, "$$5")?.code).toBe("validation.not_a_number");
    expect(validateEntry(entry, "5$")?.code).toBe("validation.not_a_number");
  });

  it("rejects values not in options list", () => {
    const entry = makeEntry({
      type: ConfigEntryType.SELECT,
      options: [
        { label: "One", value: "1" },
        { label: "Two", value: "2" },
      ],
    });
    expect(validateEntry(entry, "3")?.code).toBe("validation.invalid_option");
    expect(validateEntry(entry, "2")).toBeNull();
  });

  it("accepts a case-only difference against the options (upper=True enums)", () => {
    // esp32 `variant` options are uppercase (`ESP32`) but boards write `esp32`;
    // cv.one_of(..., upper=True) accepts it, so it must not hard-fail.
    const entry = makeEntry({
      type: ConfigEntryType.SELECT,
      options: [
        { label: "ESP32", value: "ESP32" },
        { label: "ESP32C2", value: "ESP32C2" },
      ],
    });
    expect(validateEntry(entry, "esp32")).toBeNull();
    expect(validateEntry(entry, "esp32c2")).toBeNull();
    expect(validateEntry(entry, "esp32xx")?.code).toBe("validation.invalid_option");
  });

  it("flags empty array when required", () => {
    const entry = makeEntry({ required: true, multi_value: true });
    expect(validateEntry(entry, [])?.code).toBe("validation.required");
  });
});

describe("validateEntries", () => {
  it("returns a map keyed by entry.key", () => {
    const entries = [
      makeEntry({ key: "a", required: true }),
      makeEntry({ key: "b", type: ConfigEntryType.INTEGER, range: [0, 5] }),
    ];
    const errors = validateEntries(entries, { a: "", b: 10 });
    expect(errors.get("a")?.code).toBe("validation.required");
    expect(errors.get("b")?.code).toBe("validation.max");
  });

  it("returns an empty map when everything validates", () => {
    const entries = [makeEntry({ key: "a", required: true })];
    const errors = validateEntries(entries, { a: "hello" });
    expect(errors.size).toBe(0);
  });

  it("matches depends_on gates across value types (#1360)", () => {
    // The parser hands back numbers for plain scalars while catalog gate
    // values may be strings; the compare is type-insensitive either way.
    const eq = makeEntry({ key: "a", depends_on: "mode", depends_on_value: "1" });
    expect(isEntryVisible(eq, { mode: 1 })).toBe(true);
    expect(isEntryVisible(eq, { mode: 2 })).toBe(false);
    expect(isEntryVisible(eq, {})).toBe(false);

    const ne = makeEntry({ key: "b", depends_on: "mode", depends_on_value_not: 1 });
    expect(isEntryVisible(ne, { mode: "1" })).toBe(false);
    expect(isEntryVisible(ne, { mode: "2" })).toBe(true);
    expect(isEntryVisible(ne, {})).toBe(true);

    const any = makeEntry({
      key: "c",
      depends_on: "mode",
      depends_on_value_any: ["1", "3"],
    });
    expect(isEntryVisible(any, { mode: 3 })).toBe(true);
    expect(isEntryVisible(any, { mode: 2 })).toBe(false);
    expect(isEntryVisible(any, {})).toBe(false);
    // A non-primitive never matches — String(["1"]) is "1" but an array
    // depValue must not stringify into a spurious gate hit.
    expect(isEntryVisible(eq, { mode: ["1"] })).toBe(false);
  });

  it("skips required entries gated out by depends_on_value_any", () => {
    const entries = [
      makeEntry({ key: "type", required: true }),
      makeEntry({
        key: "cs_pin",
        required: true,
        depends_on: "type",
        depends_on_value_any: ["W5500", "W6100"],
      }),
    ];
    expect(validateEntries(entries, { type: "LAN8720" }).size).toBe(0);
    expect(validateEntries(entries, { type: "W5500" }).get("cs_pin")?.code).toBe(
      "validation.required"
    );
  });

  it("recurses into NESTED entries with dotted error keys", () => {
    const entries = [
      makeEntry({
        key: "temperature",
        type: ConfigEntryType.NESTED,
        config_entries: [makeEntry({ key: "name", required: true })],
      }),
    ];
    const errors = validateEntries(entries, { temperature: { name: "" } });
    expect(errors.get("temperature.name")?.code).toBe("validation.required");
  });

  it("does not validate inside an unset hidden NESTED entry", () => {
    const entries = [
      makeEntry({
        key: "temperature",
        type: ConfigEntryType.NESTED,
        hidden: true,
        config_entries: [makeEntry({ key: "name", required: true })],
      }),
    ];
    expect(validateEntries(entries, {}).size).toBe(0);
  });

  it("validates inside a hidden NESTED entry once the YAML sets it", () => {
    const entries = [
      makeEntry({
        key: "temperature",
        type: ConfigEntryType.NESTED,
        hidden: true,
        config_entries: [makeEntry({ key: "name", required: true })],
      }),
    ];
    const errors = validateEntries(entries, { temperature: { name: "" } });
    expect(errors.get("temperature.name")?.code).toBe("validation.required");
  });

  it("validates each item of a multi_value NESTED entry with index path segments", () => {
    // ``esphome.devices`` / ``esphome.areas`` shape: the catalog
    // marks the field optional but each item's ``id`` is required.
    // Validation must visit every item and key errors at
    // ``devices.<idx>.<child>`` so the form can look them up via
    // ``path.join(".")`` against the renderer's per-item paths.
    const entries = [
      makeEntry({
        key: "devices",
        type: ConfigEntryType.NESTED,
        multi_value: true,
        required: false,
        config_entries: [
          makeEntry({ key: "id", required: true }),
          makeEntry({ key: "name" }),
        ],
      }),
    ];
    const errors = validateEntries(entries, {
      devices: [
        { id: "front" },
        {}, // missing required id
        { id: "kitchen", name: "Kitchen" },
      ],
    });
    expect(errors.get("devices.1.id")?.code).toBe("validation.required");
    // Other items should be clean.
    expect(errors.has("devices.0.id")).toBe(false);
    expect(errors.has("devices.2.id")).toBe(false);
  });

  it("treats a YamlRawValue at a multi_value NESTED key as satisfied", () => {
    // The parser preserves un-modellable list shapes as
    // ``YamlRawValue`` (dotted keys, block scalars, etc.). The
    // validator can't introspect items, so:
    //   1. A required field whose value is a YamlRawValue is
    //      satisfied by the YAML's existence — no
    //      ``validation.required`` on the bare field.
    //   2. Per-item rules can't run, so we skip recursion.
    const entries = [
      makeEntry({
        key: "devices",
        type: ConfigEntryType.NESTED,
        multi_value: true,
        required: true,
        config_entries: [makeEntry({ key: "id", required: true })],
      }),
    ];
    const errors = validateEntries(entries, {
      devices: new YamlRawValue(["    - logger.log: hello"]),
    });
    expect(errors.size).toBe(0);
  });

  it("does not validate inside an empty optional multi_value NESTED entry", () => {
    // Adding zero devices is fine for an optional field — forcing
    // an item just to opt out would mirror the bug
    // ``does not require nested children of an untouched optional
    // group`` already pins for single-nested.
    const entries = [
      makeEntry({
        key: "devices",
        type: ConfigEntryType.NESTED,
        multi_value: true,
        config_entries: [makeEntry({ key: "id", required: true })],
      }),
    ];
    expect(validateEntries(entries, {}).size).toBe(0);
    expect(validateEntries(entries, { devices: [] }).size).toBe(0);
  });

  it("flags an empty required multi_value NESTED entry on the field itself", () => {
    const entries = [
      makeEntry({
        key: "devices",
        type: ConfigEntryType.NESTED,
        multi_value: true,
        required: true,
        config_entries: [makeEntry({ key: "id", required: true })],
      }),
    ];
    const errors = validateEntries(entries, { devices: [] });
    expect(errors.get("devices")?.code).toBe("validation.required");
    // Items aren't there to validate, so no per-item errors.
    expect(errors.size).toBe(1);
  });

  it("coerces non-object items to {} so each item is still validated cleanly", () => {
    // js-yaml round-trips can briefly emit ``null`` items mid-edit
    // (a stray ``-`` line). Validation should treat those as empty
    // mappings — the recursion shouldn't blow up on
    // ``Object.keys(null)``-style descents.
    const entries = [
      makeEntry({
        key: "devices",
        type: ConfigEntryType.NESTED,
        multi_value: true,
        config_entries: [makeEntry({ key: "id", required: true })],
      }),
    ];
    const errors = validateEntries(entries, {
      devices: [null, "weird", { id: "real" }],
    });
    expect(errors.get("devices.0.id")?.code).toBe("validation.required");
    expect(errors.get("devices.1.id")?.code).toBe("validation.required");
    expect(errors.has("devices.2.id")).toBe(false);
  });

  it("does not require nested children of an untouched optional group", () => {
    // web_server.auth in real life: the auth block is optional but
    // its username/password children are required. The user must be
    // able to skip auth entirely — only validate it when they've
    // populated at least one field inside.
    const entries = [
      makeEntry({
        key: "auth",
        type: ConfigEntryType.NESTED,
        required: false,
        config_entries: [
          makeEntry({ key: "username", required: true }),
          makeEntry({ key: "password", required: true }),
        ],
      }),
    ];
    // Untouched: auth value is undefined / no child keys present.
    expect(validateEntries(entries, {}).size).toBe(0);
    expect(validateEntries(entries, { auth: {} }).size).toBe(0);
    // Once the user types into one field the other required
    // siblings get validated again.
    const partial = validateEntries(entries, {
      auth: { username: "admin" },
    });
    expect(partial.get("auth.password")?.code).toBe("validation.required");
  });

  // ---------------------------------------------------------------------
  // Optional default_value fallback
  // ---------------------------------------------------------------------
  //
  // ESPHome catalog entries can carry unit-suffixed string defaults
  // on numeric / time-period entries (``frequency: "50kHz"``,
  // ``timeout: "10s"``, ``update_interval: "60s"``). Optional entries
  // must validate clean when the user hasn't touched them — the
  // backend never sees the default, so validating against it is
  // wrong by design. Required entries still need the fallback so a
  // required-without-input entry that's been pre-defaulted by the
  // catalog doesn't surface as ``required``.

  it("does not validate optional entries against their default_value", () => {
    // Optional defaults aren't sent to the backend — ``_coerceFields``
    // strips empty optional values from the API payload — so
    // validating against them is wrong by design.
    const entries = [
      makeEntry({
        key: "frequency",
        type: ConfigEntryType.FLOAT,
        required: false,
        default_value: "50kHz",
      }),
    ];
    expect(validateEntries(entries, {}).size).toBe(0);
  });

  it("falls back to default_value for required entries", () => {
    // Mirrors ``modbus_controller.address`` (the one required
    // entry with a default in the catalog). When the value isn't
    // explicitly set, the validator falls back to the catalog
    // default — which the form's ``_seedDefaults`` pre-seeds
    // into ``_values`` anyway, so this is mostly defensive for
    // callers (e.g. section editor) that don't pre-seed.
    const entries = [
      makeEntry({
        key: "address",
        type: ConfigEntryType.INTEGER,
        required: true,
        default_value: "1",
      }),
    ];
    expect(validateEntries(entries, {}).size).toBe(0);
  });

  it("validates user-set values on optional numeric entries", () => {
    // Once the user types something, validate it normally — even on
    // optional entries. A regression that skipped optional entries
    // entirely would let bad user input through.
    const entries = [
      makeEntry({
        key: "frequency",
        type: ConfigEntryType.INTEGER,
        required: false,
        default_value: null,
      }),
    ];
    expect(validateEntries(entries, { frequency: "abc" }).get("frequency")?.code).toBe(
      "validation.not_a_number"
    );
    expect(validateEntries(entries, { frequency: 100 }).size).toBe(0);
  });

  it("validates the i2c bus shape cleanly end-to-end", () => {
    // End-to-end shape of the i2c bus catalog entry: id + several
    // optional numeric / boolean entries, every numeric one
    // carrying a unit-suffixed default.
    const i2cEntries = [
      makeEntry({ key: "scl", type: ConfigEntryType.PIN, default_value: "SCL" }),
      makeEntry({ key: "sda", type: ConfigEntryType.PIN, default_value: "SDA" }),
      makeEntry({ key: "id", type: ConfigEntryType.ID }),
      makeEntry({
        key: "frequency",
        type: ConfigEntryType.FLOAT,
        default_value: "50kHz",
      }),
      makeEntry({
        key: "scan",
        type: ConfigEntryType.BOOLEAN,
        default_value: true,
      }),
      makeEntry({
        key: "timeout",
        type: ConfigEntryType.FLOAT,
        default_value: "10ms",
      }),
    ];
    // Form's _initValues for non-featured components seeds nothing
    // for non-required entries and auto-generates the id.
    const values = { id: "i2c_1" };
    expect(validateEntries(i2cEntries, values).size).toBe(0);
  });

  // ---------------------------------------------------------------------
  // supported_platforms gate (mirrors the filterRenderable gate so a
  // hidden-by-platform required field doesn't get flagged as missing —
  // the bug Copilot caught on PR #226 before this lockstep was added).

  it("does not require a platform-gated entry on an incompatible board", () => {
    // ``sensor.debug.psram`` is required-only-on-esp32 in upstream's
    // schema — when the user picks the debug component on an
    // esp8266 board the form hides the field, so we must NOT
    // surface a "required" error for it (the user can't see the
    // input to fill it in).
    const entries = [
      makeEntry({
        key: "psram",
        required: true,
        supported_platforms: ["esp32"],
      }),
    ];
    expect(validateEntries(entries, {}, undefined, "esp8266").size).toBe(0);
    // On the matching platform the gate is a no-op and the missing
    // required field is still flagged.
    expect(validateEntries(entries, {}, undefined, "esp32").get("psram")?.code).toBe(
      "validation.required"
    );
  });

  it("treats a null/undefined targetPlatform as 'no gate'", () => {
    // The add-component dialog opens before a board is locked in;
    // we don't have a target platform yet, so platform-gated fields
    // stay visible *and* validatable. Once the user picks a board
    // the validation re-runs with targetPlatform set and gated
    // fields drop out of the required set.
    const entries = [
      makeEntry({
        key: "psram",
        required: true,
        supported_platforms: ["esp32"],
      }),
    ];
    expect(validateEntries(entries, {}).get("psram")?.code).toBe("validation.required");
    expect(validateEntries(entries, {}, undefined, null).get("psram")?.code).toBe(
      "validation.required"
    );
  });

  it("recurses through NESTED groups with the platform gate", () => {
    // Pin that the gate flows down — a required leaf inside a
    // nested group, gated to esp32, should not be flagged on
    // esp8266 even though the parent NESTED is unconstrained.
    const entries = [
      makeEntry({
        key: "diagnostics",
        type: ConfigEntryType.NESTED,
        config_entries: [
          makeEntry({
            key: "psram",
            required: true,
            supported_platforms: ["esp32"],
          }),
        ],
      }),
    ];
    // Provide a non-empty diagnostics dict so the "untouched optional
    // group" short-circuit doesn't skip validation — we want to
    // exercise the platform gate on the leaf.
    const values = { diagnostics: { psram: undefined } };
    expect(validateEntries(entries, values, undefined, "esp8266").size).toBe(0);
    expect(
      validateEntries(entries, values, undefined, "esp32").get("diagnostics.psram")?.code
    ).toBe("validation.required");
  });
});

describe("validateEntries — api encryption key format", () => {
  // `api:` → `encryption:` → `key:`, the shape the structured editor passes.
  const entries = [
    makeEntry({
      key: "encryption",
      type: ConfigEntryType.NESTED,
      config_entries: [makeEntry({ key: "key", type: ConfigEntryType.SECURE_STRING })],
    }),
  ];
  const validate = (key: unknown) =>
    validateEntries(entries, { encryption: { key } }, undefined, null, "api");

  it("flags a malformed key", () => {
    expect(validate("not-a-real-key").get("encryption.key")?.code).toBe(
      "validation.invalid_encryption_key"
    );
  });

  it("accepts a well-formed 32-byte base64 key", () => {
    expect(validate("a".repeat(43) + "=").size).toBe(0);
  });

  it("skips empty, substitution, and !secret values", () => {
    expect(validate("").size).toBe(0);
    expect(validate("${api_key}").size).toBe(0);
    expect(validate("!secret api_encryption_key").size).toBe(0);
  });

  it("does not format-check when the section isn't api", () => {
    expect(
      validateEntries(entries, { encryption: { key: "bad" } }, undefined, null).size
    ).toBe(0);
  });
});

describe("platformSupported", () => {
  it("allows when the entry has no platform constraint", () => {
    expect(platformSupported([], "esp32")).toBe(true);
    expect(platformSupported(undefined, "esp32")).toBe(true);
  });

  it("allows when the target platform is unknown", () => {
    expect(platformSupported(["bk72xx"], "")).toBe(true);
    expect(platformSupported(["bk72xx"], null)).toBe(true);
    expect(platformSupported(["bk72xx"], undefined)).toBe(true);
  });

  it("drops a component restricted to other platforms", () => {
    expect(platformSupported(["bk72xx"], "esp32")).toBe(false);
  });

  it("keeps a component that lists the target platform", () => {
    expect(platformSupported(["esp32"], "esp32")).toBe(true);
    expect(platformSupported(["esp32", "esp8266"], "esp8266")).toBe(true);
  });
});

describe("validateEntries — scalar multi_value lists (#1348)", () => {
  const intList = (extra: Record<string, unknown> = {}) =>
    makeEntry({
      key: "codes",
      type: ConfigEntryType.INTEGER,
      multi_value: true,
      ...extra,
    });

  it("passes a list of valid integers", () => {
    expect(validateEntries([intList()], { codes: [3, 5] }).size).toBe(0);
  });

  it("flags only the offending item, keyed by index", () => {
    const errors = validateEntries([intList()], { codes: ["abc", 5] });
    expect(errors.size).toBe(1);
    expect(errors.get("codes.0")?.code).toBe("validation.not_a_number");
  });

  it("skips a ${var} item (resolves at build time)", () => {
    expect(validateEntries([intList()], { codes: ["${ch}", 5] }).size).toBe(0);
  });

  it("range-checks per item", () => {
    const errors = validateEntries([intList({ range: [0, 31] })], { codes: [10, 300] });
    expect(errors.get("codes.1")?.code).toBe("validation.max");
    expect(errors.has("codes.0")).toBe(false);
  });

  it("keys a single-item list's error at index 0", () => {
    const errors = validateEntries([intList()], { codes: ["abc"] });
    expect(errors.get("codes.0")?.code).toBe("validation.not_a_number");
  });

  it("keeps required-empty at the field path and skips blank rows", () => {
    const required = intList({ required: true });
    expect(validateEntries([required], { codes: [] }).get("codes")?.code).toBe(
      "validation.required"
    );
    expect(validateEntries([required], { codes: [3, ""] }).size).toBe(0);
  });

  it("walks a required entry's array default per item, not stringified", () => {
    const entry = intList({ required: true, default_value: [3, 5] });
    expect(validateEntries([entry], {}).size).toBe(0);
  });

  it("flags a required list holding only blank rows", () => {
    const required = intList({ required: true });
    expect(validateEntries([required], { codes: ["", ""] }).get("codes")?.code).toBe(
      "validation.required"
    );
    expect(validateEntries([intList()], { codes: ["", ""] }).size).toBe(0);
  });

  it("never blocks on a hidden list of blank rows", () => {
    const entry = intList({ required: true, hidden: true });
    expect(validateEntries([entry], { codes: ["", ""] }).size).toBe(0);
  });
});

describe("validateEntries — multi_value lists the form can't itemize", () => {
  it("skips per-item checks for a list of mappings (YAML-only shape)", () => {
    const entry = makeEntry({
      key: "segments",
      type: ConfigEntryType.INTEGER,
      multi_value: true,
    });
    const errors = validateEntries([entry], { segments: [{ from: 1 }, { from: 2 }] });
    expect(errors.size).toBe(0);
  });
});

describe("clearPathErrors", () => {
  const errs = () =>
    new Map([
      ["codes", { key: "codes", code: "validation.required" }],
      ["codes.0", { key: "codes.0", code: "validation.not_a_number" }],
      ["codes_extra", { key: "codes_extra", code: "validation.required" }],
    ]);

  it("clears the key and its per-item descendants, not prefix-string siblings", () => {
    const next = clearPathErrors(errs(), "codes");
    expect(next).not.toBeNull();
    expect([...next!.keys()]).toEqual(["codes_extra"]);
  });

  it("returns null when nothing matches", () => {
    expect(clearPathErrors(errs(), "other")).toBeNull();
  });
});
