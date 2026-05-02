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
});
