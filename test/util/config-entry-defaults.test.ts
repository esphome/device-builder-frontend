import { describe, expect, it } from "vitest";
import { type ConfigEntry, ConfigEntryType } from "../../src/api/types/config-entries.js";
import { makeConfigEntry } from "../../src/util/config-entry-defaults.js";

describe("makeConfigEntry", () => {
  it("builds only the three fields the backend always sends", () => {
    expect(makeConfigEntry()).toEqual({
      key: "",
      type: ConfigEntryType.STRING,
      label: "",
    });
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
    // Everything else stays absent, as on the wire.
    expect(e).not.toHaveProperty("advanced");
    expect(e).not.toHaveProperty("options");
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
