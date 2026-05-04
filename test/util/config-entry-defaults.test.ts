import { describe, expect, it } from "vitest";
import { ConfigEntryType, type ConfigEntry } from "../../src/api/types.js";
import { makeConfigEntry } from "../../src/util/config-entry-defaults.js";

describe("makeConfigEntry", () => {
  it("populates every required ConfigEntry field with neutral defaults", () => {
    // ``ConfigEntry`` has no optional (``?:``) fields — every one
    // must be present. The renderer / form / filter chain reads
    // these unconditionally; a missing field would surface as
    // ``undefined`` and silently break a downstream check.
    const entry = makeConfigEntry();
    // Spread to a generic record so we can assert "every key is
    // present" without re-listing the type.
    const asRecord = entry as unknown as Record<string, unknown>;
    const requiredKeys = [
      "key",
      "type",
      "label",
      "description",
      "required",
      "default_value",
      "options",
      "allow_custom_value",
      "range",
      "unit_options",
      "multi_value",
      "templatable",
      "hidden",
      "advanced",
      "translation_key",
      "translation_params",
      "depends_on",
      "depends_on_value",
      "depends_on_value_not",
      "depends_on_component",
      "references_component",
      "pin_features",
      "pin_mode",
      "locked",
      "suggestions",
      "config_entries",
      "platform_type",
      "help_link",
    ];
    for (const k of requiredKeys) {
      expect(asRecord).toHaveProperty(k);
    }
  });

  it("merges overrides on top of the defaults", () => {
    const e = makeConfigEntry({
      key: "name",
      type: ConfigEntryType.STRING,
      required: true,
    });
    expect(e.key).toBe("name");
    expect(e.type).toBe(ConfigEntryType.STRING);
    expect(e.required).toBe(true);
    // Other fields keep the defaults.
    expect(e.advanced).toBe(false);
    expect(e.options).toBeNull();
  });

  it("accepts nested config_entries (the substitutions MAP shape)", () => {
    const e = makeConfigEntry({
      type: ConfigEntryType.MAP,
      config_entries: [makeConfigEntry({ key: "value", required: true })],
    });
    expect(e.type).toBe(ConfigEntryType.MAP);
    expect(e.config_entries).toHaveLength(1);
    expect(e.config_entries![0]!.key).toBe("value");
  });

  it("returns an entry that satisfies the ConfigEntry type at compile time", () => {
    // Explicit type annotation — if a new required field is added
    // to ``ConfigEntry`` and ``makeConfigEntry`` doesn't fill it,
    // ``tsc`` fails this assignment.
    const _entry: ConfigEntry = makeConfigEntry();
    expect(_entry).toBeDefined();
  });
});
