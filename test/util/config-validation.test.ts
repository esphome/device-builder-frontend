import { describe, expect, it } from "vitest";
import { ConfigEntryType, type ConfigEntry } from "../../src/api/types.js";
import {
  getDeviceNameWarning,
  validateDeviceName,
  validateEntries,
  validateEntry,
} from "../../src/util/config-validation.js";

function makeEntry(overrides: Partial<ConfigEntry>): ConfigEntry {
  return {
    key: "foo",
    type: ConfigEntryType.STRING,
    label: "Foo",
    default_value: null,
    required: false,
    description: null,
    options: null,
    allow_custom_value: false,
    range: null,
    help_link: null,
    multi_value: false,
    hidden: false,
    advanced: false,
    translation_key: null,
    translation_params: null,
    templatable: false,
    depends_on: null,
    depends_on_value: null,
    depends_on_value_not: null,
    depends_on_component: null,
    references_component: null,
    pin_features: [],
    pin_mode: null,
    locked: false,
    suggestions: null,
    config_entries: null,
    platform_type: null,
    ...overrides,
  };
}

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
      "validation.device_name_underscore",
    );
  });

  it("warns about leading or trailing hyphens", () => {
    /* RFC 952/1123 forbids edge hyphens in DNS labels, so they
       have the same mDNS-resolution risk as underscores. */
    expect(getDeviceNameWarning("-foo")?.code).toBe(
      "validation.device_name_edge_hyphen",
    );
    expect(getDeviceNameWarning("foo-")?.code).toBe(
      "validation.device_name_edge_hyphen",
    );
  });

  it("returns null for clean hyphenated names", () => {
    expect(getDeviceNameWarning("my-device")).toBeNull();
    expect(getDeviceNameWarning("device42")).toBeNull();
  });
});

describe("validateEntry", () => {
  it("flags required empty field", () => {
    const entry = makeEntry({ required: true });
    expect(validateEntry(entry, "")?.code).toBe("validation.required");
    expect(validateEntry(entry, undefined)?.code).toBe("validation.required");
  });

  it("ignores hidden fields entirely", () => {
    const entry = makeEntry({ required: true, hidden: true });
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

  it("accepts floats on FLOAT fields", () => {
    const entry = makeEntry({ type: ConfigEntryType.FLOAT });
    expect(validateEntry(entry, 3.5)).toBeNull();
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

  it("does not validate inside a hidden NESTED entry", () => {
    const entries = [
      makeEntry({
        key: "temperature",
        type: ConfigEntryType.NESTED,
        hidden: true,
        config_entries: [makeEntry({ key: "name", required: true })],
      }),
    ];
    const errors = validateEntries(entries, { temperature: {} });
    expect(errors.size).toBe(0);
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
  // Optional default_value fallback regression — MasterOfNone bug
  // ---------------------------------------------------------------------
  //
  // ESPHome catalog entries often carry unit-suffixed defaults
  // (``frequency: "50kHz"``, ``timeout: "10s"``, ``update_interval:
  // "60s"``) on numeric / time-period entries. The validator used to
  // fall back to ``default_value`` for ALL entries, which made
  // ``Number("50kHz") = NaN`` for every untouched optional numeric
  // field — flagging ``validation.not_a_number`` for fields the user
  // can't see in ``required-only`` mode.
  //
  // The form's submit guard then bailed silently on the validation
  // error and the user reported the symptom as
  // ``Add ES7210 → Add i2c → blue Add does nothing``.
  //
  // Pin: optional entries with unit-suffixed defaults must validate
  // clean when the user hasn't touched them. Required entries still
  // need the fallback so a required-without-input entry that's been
  // pre-defaulted by the catalog doesn't surface as ``required``.

  it("does not validate optional numeric entries against unit-suffixed defaults", () => {
    // Reproduces the i2c.frequency case verbatim: optional FLOAT
    // entry with a string default like ``"50kHz"``.
    const entries = [
      makeEntry({
        key: "frequency",
        type: ConfigEntryType.FLOAT,
        required: false,
        default_value: "50kHz",
      }),
    ];
    // User never touched the field — no value in the dict.
    expect(validateEntries(entries, {}).size).toBe(0);
    // User explicitly set a unit-suffixed string — also accepted
    // (the upstream ``cv.frequency`` / ``cv.time_period`` shape).
    expect(validateEntries(entries, { frequency: "100kHz" }).size).toBe(0);
  });

  it("does not validate optional time-period entries against unit-suffixed defaults", () => {
    const entries = [
      makeEntry({
        key: "timeout",
        type: ConfigEntryType.FLOAT,
        required: false,
        default_value: "10s",
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

  it("accepts unit-suffixed strings on FLOAT/INTEGER required defaults", () => {
    // The MasterOfNone case in reverse: when the catalog default
    // for a numeric entry is a unit-suffixed string (``"50kHz"``,
    // ``"10s"``, ``"100ms"``) — which is the actual upstream
    // ``cv.frequency`` / ``cv.time_period`` shape — the validator
    // must accept it as the seeded value, not reject it as
    // ``validation.not_a_number``.
    const entries = [
      makeEntry({
        key: "frequency",
        type: ConfigEntryType.FLOAT,
        required: true,
        default_value: "50kHz",
      }),
    ];
    // Required + default_value="50kHz" + values empty → fallback
    // kicks in → "50kHz" is parsed numerically as 50 → no error.
    expect(validateEntries(entries, {}).size).toBe(0);
    // User-set unit-suffixed string also accepted.
    expect(validateEntries(entries, { frequency: "1.5MHz" }).size).toBe(0);
    // Range checks apply to the numeric prefix.
    const ranged = [
      makeEntry({
        key: "frequency",
        type: ConfigEntryType.FLOAT,
        required: true,
        default_value: "50kHz",
        range: [10, 100],
      }),
    ];
    // 5kHz < 10 → range error on the parsed prefix.
    expect(validateEntries(ranged, { frequency: "5kHz" }).get("frequency")?.code)
      .toBe("validation.min");
    // 200kHz > 100 → max error.
    expect(validateEntries(ranged, { frequency: "200kHz" }).get("frequency")?.code)
      .toBe("validation.max");
  });

  it("rejects strings with no parseable numeric prefix on FLOAT/INTEGER", () => {
    // Defensive: even with the unit-suffix relaxation, a string
    // that has no numeric prefix at all is still nonsense.
    const entries = [
      makeEntry({
        key: "frequency",
        type: ConfigEntryType.FLOAT,
        required: true,
      }),
    ];
    expect(validateEntries(entries, { frequency: "abc" }).get("frequency")?.code)
      .toBe("validation.not_a_number");
    expect(validateEntries(entries, { frequency: "kHz" }).get("frequency")?.code)
      .toBe("validation.not_a_number");
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
    expect(validateEntries(entries, { frequency: "abc" }).get("frequency")?.code)
      .toBe("validation.not_a_number");
    expect(validateEntries(entries, { frequency: 100 }).size).toBe(0);
  });

  it("does not validate the i2c bus shape end-to-end", () => {
    // End-to-end shape of the i2c bus catalog entry (the original
    // MasterOfNone repro): id + several optional numeric / boolean
    // entries, every numeric one carrying a unit-suffixed default.
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
});
