/** Unit tests for `unitAdvancedGate`. */
import { describe, expect, it } from "vitest";

import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { unitAdvancedGate } from "../../../src/components/device/config-entry-form-plan.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const entry = (key: string, extra: Partial<ConfigEntry> = {}): ConfigEntry =>
  makeConfigEntry({ key, type: ConfigEntryType.STRING, label: key, ...extra });

describe("unitAdvancedGate", () => {
  it("gates a constraint cluster only while every member is advanced and unvalued", () => {
    const entries = [
      entry("a", { advanced: true, group: "grp" }),
      entry("b", { advanced: true, group: "grp" }),
      entry("plain"),
    ];
    expect(unitAdvancedGate(entries, [], {})("b")).toBe(true);
    expect(unitAdvancedGate(entries, [], { a: "set" })("b")).toBe(false);
    expect(unitAdvancedGate(entries, [], {})("plain")).toBeUndefined();
  });

  it("does not gate a mixed cluster — it renders in the basic bucket", () => {
    const entries = [
      entry("a", { group: "grp" }),
      entry("b", { advanced: true, group: "grp" }),
    ];
    expect(unitAdvancedGate(entries, [], {})("b")).toBe(false);
  });

  it("answers for every exclusive-group member, first included", () => {
    // The first member's mapping must see later joiners of the group.
    const entries = [
      entry("first", { advanced: true, exclusive_group: "g" }),
      entry("second", { advanced: true, exclusive_group: "g" }),
    ];
    expect(unitAdvancedGate(entries, [], { second: "set" })("first")).toBe(false);
    expect(unitAdvancedGate(entries, [], {})("first")).toBe(true);
    expect(unitAdvancedGate(entries, [], {})("second")).toBe(true);
  });
});
