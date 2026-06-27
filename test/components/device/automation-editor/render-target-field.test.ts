/**
 * Tests for ``renderTargetField`` (#1711) — the automation editor's read-only
 * Target identity field. Asserts rendered output (the raw value in the input
 * plus the resolved ${...} hint) rather than the editor's source text, which
 * the editor itself can't do in vitest because it pulls in CodeMirror.
 */
import { describe, expect, it } from "vitest";
import { renderTargetField } from "../../../../src/components/device/automation-editor/render-target-field.js";
import { findTemplatesByAnchor } from "../../../_lit-template-walker.js";
import { findElementBindings } from "../_renderer-fixtures.js";

const localize = (k: string) => k;

const spanValues = (tmpl: unknown): unknown[] =>
  findTemplatesByAnchor(tmpl, "<span").flatMap((t) => t.values as unknown[]);

describe("renderTargetField", () => {
  it("keeps the raw value in the input and previews the resolved substitution", () => {
    const tmpl = renderTargetField(
      "${device_friendly_name} Switch (binary_sensor.gpio)",
      new Map([["device_friendly_name", "WIFI Switch"]]),
      localize
    );
    const input = findElementBindings(tmpl, "input")[0];
    expect(input[".value"]).toBe("${device_friendly_name} Switch (binary_sensor.gpio)");
    expect(
      spanValues(tmpl).some(
        (v) =>
          typeof v === "string" && v.includes("WIFI Switch Switch (binary_sensor.gpio)")
      )
    ).toBe(true);
  });

  it("renders no hint chip when the target has no substitution", () => {
    const tmpl = renderTargetField("Relay (switch.gpio)", new Map(), localize);
    expect(findElementBindings(tmpl, "input")[0][".value"]).toBe("Relay (switch.gpio)");
    // The hint is the only <span> the field emits; absent means no chip.
    expect(findTemplatesByAnchor(tmpl, "<span")).toHaveLength(0);
  });
});
