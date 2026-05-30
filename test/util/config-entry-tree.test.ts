/** Unit tests for `actionAdvancedState`. */
import { describe, expect, it } from "vitest";

import type { ConfigEntry } from "../../src/api/types.js";
import { ConfigEntryType } from "../../src/api/types.js";
import { actionAdvancedState } from "../../src/util/config-entry-tree.js";

function entry(key: string, advanced: boolean): ConfigEntry {
  return { key, type: ConfigEntryType.STRING, label: key, advanced } as ConfigEntry;
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
