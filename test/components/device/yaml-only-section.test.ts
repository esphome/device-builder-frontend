/**
 * Tests for the YAML-only-section gate.
 *
 * Both ``external_components`` and ``packages`` are always YAML-
 * only because their schemas have shapes the catalog model can't
 * express:
 *
 * - ``external_components.source`` is a string-or-typed-object
 *   discriminated union (#337).
 * - ``packages`` accepts both a user-keyed dict and a list of
 *   package definitions, with each value being a discriminated
 *   union (string shorthand / ``!include`` directive / typed
 *   remote-package object / inline package contents). Routing it
 *   through the dict-only ``MAP_SECTIONS`` previously corrupted
 *   list-shaped configs — see #361.
 *
 * The YAML-only and MAP sets must stay disjoint — YAML-only takes
 * precedence in the render path, so an entry in both would
 * silently demote a MAP section to a YAML notice.
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

  it("contains packages — issue #361 (list shape would corrupt)", () => {
    // ``packages`` accepts both ``{name: pkg}`` and ``[pkg, pkg]``
    // upstream. The dict-only ``renderMapField`` silently
    // overwrote a list-shaped YAML with ``{}`` on save (#361).
    // Pinning YAML-only keeps both shapes round-tripping cleanly
    // through the YAML pane.
    expect(YAML_ONLY_SECTIONS.has("packages")).toBe(true);
    expect(MAP_SECTIONS.has("packages")).toBe(false);
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
    // (a cleared value is intentional data) and isn't relevant
    // anywhere else right now.
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

  it("returns true for packages regardless of entry count (#361)", () => {
    // The bogus catalog shape ESPHome ships for packages would
    // otherwise route through the form path; pin that the
    // YAML-only gate fires before that even with non-zero
    // entries.
    expect(isYamlOnlySection("packages", 0)).toBe(true);
    expect(isYamlOnlySection("packages", 9)).toBe(true);
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
