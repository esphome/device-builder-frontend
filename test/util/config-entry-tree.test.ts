/** Unit tests for `actionAdvancedState`. */
import { describe, expect, it } from "vitest";

import type { ConfigEntry } from "../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { actionAdvancedState, pathIsAdvanced } from "../../src/util/config-entry-tree.js";

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

describe("actionAdvancedState", () => {
  it("hides the toggle and leaves the form closed when nothing is advanced", () => {
    const entries = [entry("format", false), entry("level", false)];
    expect(actionAdvancedState(entries, false)).toEqual({
      showAdvanced: false,
      showToggle: false,
    });
  });

  it("force-opens the form and hides the toggle when every entry is advanced", () => {
    const entries = [entry("seconds", true), entry("milliseconds", true)];
    expect(actionAdvancedState(entries, false)).toEqual({
      showAdvanced: true,
      showToggle: false,
    });
  });

  it("shows the toggle for the mixed case, deferring to the user's choice", () => {
    // logger.log: required format + non-advanced level + advanced args.
    const entries = [entry("format", false), entry("level", false), entry("args", true)];
    expect(actionAdvancedState(entries, false)).toEqual({
      showAdvanced: false,
      showToggle: true,
    });
    expect(actionAdvancedState(entries, true)).toEqual({
      showAdvanced: true,
      showToggle: true,
    });
  });

  it("hides the toggle for an empty entry list", () => {
    expect(actionAdvancedState([], false)).toEqual({
      showAdvanced: false,
      showToggle: false,
    });
  });
});

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
