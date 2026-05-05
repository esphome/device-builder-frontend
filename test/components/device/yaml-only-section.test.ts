/**
 * Tests for the YAML-only-section gate in `device-section-config`.
 *
 * Only `external_components` is *always* YAML-only: its `source` field
 * accepts both a string shorthand and a typed-object form, and the
 * catalog model can't express the discriminated union (issue #337).
 *
 * `packages` is not on this list — it goes through the MAP-section
 * fallback (see ``MAP_SECTIONS`` in ``util/section-entry-overrides``)
 * so the user gets a partial structured editor with per-row "edit in
 * YAML" placeholders for the nested package bodies.
 *
 * Empty-entry sections fall through to YAML-only — pinning that
 * branch keeps the empty-schema fallback honest as the form-editor
 * grows.
 */

import { describe, expect, it } from "vitest";

import {
  YAML_ONLY_SECTIONS,
  isYamlOnlySection,
} from "../../../src/components/device/yaml-only-sections.js";
import { MAP_SECTIONS } from "../../../src/util/section-entry-overrides.js";

describe("YAML_ONLY_SECTIONS", () => {
  it("contains external_components — issue #337", () => {
    expect(YAML_ONLY_SECTIONS.has("external_components")).toBe(true);
  });

  it("does NOT contain packages — packages uses the MAP fallback", () => {
    // Two-set invariant: a section is either MAP (partial structured
    // editor with per-row YAML escape) or YAML-only (full notice).
    // Putting packages in both would cause the YAML-only check to
    // win and the user would lose the MAP editor. Pin the
    // mutual-exclusion so a future re-add to YAML_ONLY_SECTIONS
    // surfaces here.
    expect(YAML_ONLY_SECTIONS.has("packages")).toBe(false);
    expect(MAP_SECTIONS.has("packages")).toBe(true);
  });

  it("YAML_ONLY_SECTIONS and MAP_SECTIONS are mutually exclusive", () => {
    // The render gate (`isYamlOnlySection`) runs *before* the MAP
    // resolver in `device-section-config`, so an entry in both sets
    // would be silently demoted to YAML-only and the MAP renderer
    // would never run. Pin the disjoint invariant explicitly.
    for (const key of YAML_ONLY_SECTIONS) {
      expect(MAP_SECTIONS.has(key)).toBe(false);
    }
  });
});

describe("isYamlOnlySection", () => {
  it("returns true for external_components regardless of entry count", () => {
    // Even when the backend returns the (broken) string-shorthand
    // schema with one entry, the form must NOT render — the user
    // would be unable to edit the typed-object form. Pin the
    // entries>0 branch explicitly.
    expect(isYamlOnlySection("external_components", 0)).toBe(true);
    expect(isYamlOnlySection("external_components", 3)).toBe(true);
  });

  it("returns false for packages (MAP fallback owns this)", () => {
    // packages is rendered via the MAP_SECTIONS override path —
    // ``isYamlOnlySection`` must return false so the gate doesn't
    // short-circuit the MAP resolver.
    expect(isYamlOnlySection("packages", 9)).toBe(false);
  });

  it("returns true for any section with zero entries (empty-schema fallback)", () => {
    // Sections that don't have a structured schema yet (free-form,
    // backend-not-yet-introspected) should fall through to the
    // YAML notice instead of rendering an empty form. Pin one
    // arbitrary key plus the catalog's actual structural entries.
    expect(isYamlOnlySection("substitutions", 0)).toBe(true);
    expect(isYamlOnlySection("some_unknown_key", 0)).toBe(true);
  });

  it("returns false for an arbitrary section with entries", () => {
    // The form-editor path: schema entries are present and the
    // section isn't on the always-YAML list, so the structured
    // form renders. Pin so a regression that flips the default to
    // YAML-only (e.g. dropping the always-list intersection)
    // surfaces here as a broad break rather than a subtle UX
    // regression.
    expect(isYamlOnlySection("wifi", 4)).toBe(false);
    expect(isYamlOnlySection("api", 2)).toBe(false);
  });
});
