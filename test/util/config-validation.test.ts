import { describe, expect, it } from "vitest";
import { ConfigEntryType } from "../../src/api/types.js";
import {
  getDeviceNameWarning,
  validateDeviceName,
  validateEntries,
  validateEntry,
} from "../../src/util/config-validation.js";
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

  it("validates the numeric portion of FLOAT_WITH_UNIT entries", () => {
    const entry = makeEntry({
      type: ConfigEntryType.FLOAT_WITH_UNIT,
      unit_options: ["Hz", "kHz", "MHz"],
    });
    expect(validateEntry(entry, "50kHz")).toBeNull();
    expect(validateEntry(entry, "3.3 V")?.code).toBe("validation.not_a_number");
    expect(validateEntry(entry, "abckHz")?.code).toBe(
      "validation.not_a_number",
    );
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
    expect(validateEntries(entries, { frequency: "abc" }).get("frequency")?.code)
      .toBe("validation.not_a_number");
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
});
