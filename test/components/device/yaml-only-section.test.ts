/**
 * Tests for the YAML-only-section gate.
 *
 * `external_components` is always YAML-only (catalog can't express
 * the `source` discriminated union — issue #337). `packages` rides
 * ``MAP_SECTIONS`` instead. The two sets must stay disjoint —
 * YAML-only takes precedence in the render path, so an entry in
 * both would silently demote a MAP section to a YAML notice.
 */

import { describe, expect, it } from "vitest";

import {
  YAML_ONLY_SECTIONS,
  isYamlOnlySection,
} from "../../../src/components/device/yaml-only-sections.js";
import {
  KEEP_EMPTY_STRING_SECTIONS,
  MAP_SECTIONS,
} from "../../../src/util/section-entry-overrides.js";

describe("YAML_ONLY_SECTIONS", () => {
  it("contains external_components — issue #337", () => {
    expect(YAML_ONLY_SECTIONS.has("external_components")).toBe(true);
  });

  it("does NOT contain packages — packages uses the MAP fallback", () => {
    expect(YAML_ONLY_SECTIONS.has("packages")).toBe(false);
    expect(MAP_SECTIONS.has("packages")).toBe(true);
  });

  it("YAML_ONLY_SECTIONS and MAP_SECTIONS are mutually exclusive", () => {
    // YAML-only takes precedence — an entry in both would silently
    // demote a MAP section to a YAML notice.
    for (const key of YAML_ONLY_SECTIONS) {
      expect(MAP_SECTIONS.has(key)).toBe(false);
    }
  });
});

describe("KEEP_EMPTY_STRING_SECTIONS", () => {
  it("contains substitutions only — substitutions-specific contract", () => {
    // The keep-empty-strings invariant matters for substitutions
    // (a cleared value is intentional data) but breaks ``packages``
    // (an empty value is a placeholder row whose YAML is
    // syntactically valid but rejected by ESPHome's ``packages:``
    // schema validator). Pin substitutions in, packages out.
    expect(KEEP_EMPTY_STRING_SECTIONS.has("substitutions")).toBe(true);
    expect(KEEP_EMPTY_STRING_SECTIONS.has("packages")).toBe(false);
  });

  it("is a strict subset of MAP_SECTIONS", () => {
    // Empty-string preservation only makes sense for sections that
    // *are* MAP-rendered in the first place — outside that path
    // there's no row-key/value distinction for the flag to apply
    // to. Pin so a future addition here that isn't also in
    // MAP_SECTIONS surfaces immediately.
    for (const key of KEEP_EMPTY_STRING_SECTIONS) {
      expect(MAP_SECTIONS.has(key)).toBe(true);
    }
  });
});

describe("isYamlOnlySection", () => {
  it("returns true for external_components regardless of entry count", () => {
    expect(isYamlOnlySection("external_components", 0)).toBe(true);
    expect(isYamlOnlySection("external_components", 3)).toBe(true);
  });

  it("returns false for packages so the MAP resolver runs", () => {
    expect(isYamlOnlySection("packages", 9)).toBe(false);
  });

  it("returns true for any section with zero entries", () => {
    expect(isYamlOnlySection("substitutions", 0)).toBe(true);
    expect(isYamlOnlySection("some_unknown_key", 0)).toBe(true);
  });

  it("returns false for an arbitrary section with entries", () => {
    expect(isYamlOnlySection("wifi", 4)).toBe(false);
    expect(isYamlOnlySection("api", 2)).toBe(false);
  });
});
