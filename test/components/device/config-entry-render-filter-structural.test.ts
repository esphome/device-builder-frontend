/**
 * Tests for ``_isStructuralType`` — the predicate the templatable
 * wrapper consults to decide whether a literal/lambda toggle makes
 * sense for an entry. Structural types are layout / grouping /
 * annotation; only leaf-shaped types are templatable.
 */
import { describe, expect, it } from "vitest";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { _isStructuralType } from "../../../src/components/device/config-entry-render-filter.js";

describe("_isStructuralType", () => {
  it("flags layout / grouping / annotation types", () => {
    expect(_isStructuralType(ConfigEntryType.NESTED)).toBe(true);
    expect(_isStructuralType(ConfigEntryType.MAP)).toBe(true);
    expect(_isStructuralType(ConfigEntryType.DIVIDER)).toBe(true);
    expect(_isStructuralType(ConfigEntryType.LABEL)).toBe(true);
    expect(_isStructuralType(ConfigEntryType.ALERT)).toBe(true);
  });

  it("does not flag leaf primitive types — they remain templatable", () => {
    expect(_isStructuralType(ConfigEntryType.STRING)).toBe(false);
    expect(_isStructuralType(ConfigEntryType.INTEGER)).toBe(false);
    expect(_isStructuralType(ConfigEntryType.FLOAT)).toBe(false);
    expect(_isStructuralType(ConfigEntryType.BOOLEAN)).toBe(false);
    expect(_isStructuralType(ConfigEntryType.PIN)).toBe(false);
    expect(_isStructuralType(ConfigEntryType.LAMBDA)).toBe(false);
    expect(_isStructuralType(ConfigEntryType.TRIGGER)).toBe(false);
  });
});
