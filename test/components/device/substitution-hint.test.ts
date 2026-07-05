/**
 * Unit tests for ``renderSubstitutionHint`` (#1711). The helper takes the
 * substitution map + localize directly so non-RenderCtx hosts (the automation
 * editor's read-only Target field) can render the same ${...} preview chip the
 * text fields show.
 */
import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import { renderSubstitutionHint } from "../../../src/components/device/config-entry-renderers-shared.js";
import { identityLocalize as localize } from "../../_dom.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";

const spanValues = (tmpl: unknown): unknown[] =>
  findTemplatesByAnchor(tmpl, "<span").flatMap((t) => t.values as unknown[]);

describe("renderSubstitutionHint", () => {
  it("returns nothing when the value has no ${...} reference", () => {
    expect(renderSubstitutionHint("plain value", new Map(), localize)).toBe(nothing);
  });

  it("previews the resolved value when the substitution is known", () => {
    const tmpl = renderSubstitutionHint(
      "${device_friendly_name} Switch (binary_sensor.gpio)",
      new Map([["device_friendly_name", "WIFI Switch"]]),
      localize
    );
    expect(
      spanValues(tmpl).some(
        (v) =>
          typeof v === "string" && v.includes("WIFI Switch Switch (binary_sensor.gpio)")
      )
    ).toBe(true);
  });

  it("marks an unresolved reference (defined outside this file) instead of previewing", () => {
    const tmpl = renderSubstitutionHint("${from_a_package} X", new Map(), localize);
    expect(spanValues(tmpl)).toContain("device.substitution_unresolved");
  });
});
