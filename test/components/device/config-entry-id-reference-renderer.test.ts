/**
 * Tests for ``renderIdReferenceField`` (#1312). An id-reference field's
 * value can point at a component defined outside the scanned YAML (a
 * ``packages:`` include / another file); the picker must still surface it as
 * a selected option so it displays and round-trips instead of vanishing.
 */
import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderIdReferenceField } from "../../../src/components/device/config-entry-id-reference-renderer.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
import { findElementBindings, makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

const LOCAL_SCRIPT_YAML = "script:\n  - id: local_script\n";

function renderFor(yaml: string, value: string) {
  const entry = makeEntry(ConfigEntryType.STRING, { references_component: "script" });
  return renderIdReferenceField(
    entry,
    ["id"],
    makeRenderCtx({ id: value }, { overrides: { yaml } })
  );
}

describe("renderIdReferenceField — value defined outside the scanned YAML (#1312)", () => {
  it("keeps a referenced id that isn't a local candidate (e.g. from a package)", () => {
    const opts = findElementBindings(
      renderFor(LOCAL_SCRIPT_YAML, "pkg_script"),
      "wa-option"
    );
    const byValue = Object.fromEntries(opts.map((o) => [o.value, o]));
    // The package id is present AND selected, so it displays + round-trips.
    expect(byValue["pkg_script"]).toBeDefined();
    expect(byValue["pkg_script"]["?selected"]).toBe(true);
    // The local candidate is still offered.
    expect(byValue["local_script"]).toBeDefined();
  });

  it("renders the orphan value even when there are no local candidates", () => {
    const values = findElementBindings(renderFor("", "pkg_script"), "wa-option").map(
      (o) => o.value
    );
    expect(values).toContain("pkg_script");
  });

  it("does not duplicate an id that is already a local candidate", () => {
    const values = findElementBindings(
      renderFor(LOCAL_SCRIPT_YAML, "local_script"),
      "wa-option"
    ).map((o) => o.value);
    expect(values.filter((v) => v === "local_script")).toHaveLength(1);
  });
});

describe("renderIdReferenceField — single-candidate auto-resolve default", () => {
  const SINGLE_LD2410 = "ld2410:\n  id: radar\n";

  function renderRef(domain: string, yaml: string, value: string) {
    const entry = makeEntry(ConfigEntryType.STRING, { references_component: domain });
    return renderIdReferenceField(
      entry,
      ["id"],
      makeRenderCtx({ id: value }, { overrides: { yaml } })
    );
  }

  const placeholderOf = (tmpl: unknown): unknown =>
    findElementBindings(tmpl, "wa-select")[0]?.placeholder;

  const hasDefaultTag = (tmpl: unknown): boolean =>
    findTemplatesByAnchor(tmpl, "<wa-option").some((t) =>
      (t.values as unknown[]).some(
        (v) => typeof v === "string" && v.includes("device.default_option_tag")
      )
    );

  it("shows the sole candidate as the default and tags its option", () => {
    const tmpl = renderRef("ld2410", SINGLE_LD2410, "");
    expect(placeholderOf(tmpl)).toBe("radar");
    expect(hasDefaultTag(tmpl)).toBe(true);
  });

  it("does not auto-select the default option (the field stays omitted)", () => {
    const opt = findElementBindings(
      renderRef("ld2410", SINGLE_LD2410, ""),
      "wa-option"
    ).find((o) => o.value === "radar");
    expect(opt?.["?selected"]).toBe(false);
  });

  it("suppresses the default when packages: can merge in another match", () => {
    const tmpl = renderRef(
      "ld2410",
      `packages:\n  base: !include base.yaml\n${SINGLE_LD2410}`,
      ""
    );
    expect(placeholderOf(tmpl)).toBe(nothing);
    expect(hasDefaultTag(tmpl)).toBe(false);
  });

  it("suppresses the default when a top-level <<: merge can hide another match", () => {
    const tmpl = renderRef("ld2410", `<<: !include common.yaml\n${SINGLE_LD2410}`, "");
    expect(placeholderOf(tmpl)).toBe(nothing);
    expect(hasDefaultTag(tmpl)).toBe(false);
  });

  it("shows no default when more than one candidate exists", () => {
    const tmpl = renderRef("script", "script:\n  - id: a\n  - id: b\n", "");
    expect(placeholderOf(tmpl)).toBe(nothing);
    expect(hasDefaultTag(tmpl)).toBe(false);
  });

  it("shows no default once the field has a committed value", () => {
    expect(placeholderOf(renderRef("ld2410", SINGLE_LD2410, "radar"))).toBe(nothing);
  });
});
