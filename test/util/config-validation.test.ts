import { describe, expect, it } from "vitest";
import { ConfigEntryType, type ConfigEntry } from "../../src/api/types.js";
import {
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

  it("rejects uppercase and underscores", () => {
    expect(validateDeviceName("MyDevice")?.code).toBe("validation.invalid_device_name");
    expect(validateDeviceName("my_device")?.code).toBe("validation.invalid_device_name");
  });

  it("rejects leading/trailing hyphen", () => {
    expect(validateDeviceName("-foo")?.code).toBe("validation.invalid_device_name");
    expect(validateDeviceName("foo-")?.code).toBe("validation.invalid_device_name");
  });

  it("rejects names over 63 chars", () => {
    expect(validateDeviceName("a".repeat(64))?.code).toBe("validation.max_length");
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
});
