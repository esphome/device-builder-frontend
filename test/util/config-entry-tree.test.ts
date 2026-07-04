/** Unit tests for `pathIsAdvanced`. */
import { describe, expect, it } from "vitest";

import type { ConfigEntry } from "../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { pathIsAdvanced } from "../../src/util/config-entry-tree.js";

function entry(key: string, advanced: boolean): ConfigEntry {
  return { key, type: ConfigEntryType.STRING, label: key, advanced } as ConfigEntry;
}

function nested(key: string, advanced: boolean, children: ConfigEntry[]): ConfigEntry {
  return {
    key,
    type: ConfigEntryType.NESTED,
    label: key,
    advanced,
    config_entries: children,
  } as ConfigEntry;
}

describe("pathIsAdvanced", () => {
  const entries = [
    entry("name", false),
    entry("hide_timestamp", true),
    nested("filters", false, [entry("multiply", true)]),
    nested("calibrate", true, [entry("method", false)]),
  ];

  it("is true for an advanced leaf", () => {
    expect(pathIsAdvanced(entries, ["hide_timestamp"])).toBe(true);
  });

  it("is false for a plain leaf", () => {
    expect(pathIsAdvanced(entries, ["name"])).toBe(false);
  });

  it("is true when an advanced ancestor gates a plain leaf", () => {
    expect(pathIsAdvanced(entries, ["calibrate", "method"])).toBe(true);
  });

  it("is true for an advanced leaf under a plain ancestor", () => {
    expect(pathIsAdvanced(entries, ["filters", "multiply"])).toBe(true);
  });

  it("is false when the path doesn't resolve", () => {
    expect(pathIsAdvanced(entries, ["bogus"])).toBe(false);
    expect(pathIsAdvanced(entries, [])).toBe(false);
  });
});
