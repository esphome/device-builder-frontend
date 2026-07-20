/**
 * Tests for ``renderIdReferenceField`` (#1312). An id-reference field's
 * value can point at a component defined outside the scanned YAML (a
 * ``packages:`` include / another file); the picker must still surface it as
 * a selected option so it displays and round-trips instead of vanishing.
 */
import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import {
  ADD_NEW_SENTINEL,
  AUTO_SENTINEL,
  renderIdReferenceField,
} from "../../../src/components/device/config-entry-id-reference-renderer.js";
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

describe("renderIdReferenceField — resolves ${...} in option labels (#1709)", () => {
  function renderRef(domain: string, yaml: string, value: string) {
    const entry = makeEntry(ConfigEntryType.STRING, { references_component: domain });
    return renderIdReferenceField(
      entry,
      ["id"],
      makeRenderCtx({ id: value }, { overrides: { yaml } })
    );
  }

  const SUBS = "substitutions:\n  device_friendly_name: WIFI Switch\n";
  const SWITCH = (name: string) =>
    `${SUBS}switch:\n  - platform: output\n    id: relay\n    name: "${name}"\n`;

  const labelOf = (tmpl: unknown, value: string): unknown =>
    findElementBindings(tmpl, "wa-option").find((o) => o.value === value)?.[".label"];

  it("resolves a substitution in the option's display label", () => {
    expect(
      labelOf(renderRef("switch", SWITCH("${device_friendly_name} Relay"), ""), "relay")
    ).toBe("WIFI Switch Relay");
  });

  it("leaves an unknown substitution literal (graceful degrade)", () => {
    expect(labelOf(renderRef("switch", SWITCH("${unknown} Relay"), ""), "relay")).toBe(
      "${unknown} Relay"
    );
  });

  it("resolves the substitution in the sole-candidate placeholder", () => {
    const select = findElementBindings(
      renderRef("switch", SWITCH("${device_friendly_name} Relay"), ""),
      "wa-select"
    )[0];
    expect(select?.placeholder).toBe("WIFI Switch Relay");
  });
});

describe("renderIdReferenceField — inline error for an unknown id", () => {
  const APOLLO_YAML = [
    "output:",
    "  - platform: ledc",
    "    pin: 18",
    "    id: buzzer_outputd",
    "",
    "rtttl:",
    "  - output: buzzer_output",
    "    id: rtttl_player",
    "",
  ].join("\n");

  function renderOutputRef(
    yaml: string,
    value: string,
    ctxOverrides: Record<string, unknown> = {}
  ) {
    const entry = makeEntry(ConfigEntryType.STRING, { references_component: "output" });
    return renderIdReferenceField(
      entry,
      ["output"],
      makeRenderCtx({ output: value }, { overrides: { yaml, ...ctxOverrides } })
    );
  }

  const errorTexts = (tmpl: unknown): unknown[] =>
    findTemplatesByAnchor(tmpl, "field-error").map((t) => t.values[0]);

  const selectInvalid = (tmpl: unknown): unknown =>
    findElementBindings(tmpl, "wa-select")[0]?.class;

  it("flags a dangling reference with an inline error and invalid state", () => {
    const tmpl = renderOutputRef(APOLLO_YAML, "buzzer_output");
    expect(errorTexts(tmpl)).toContain("device.id_reference_unknown_error");
    expect(selectInvalid(tmpl)).toBe("invalid");
  });

  it("does not flag a resolving reference", () => {
    const tmpl = renderOutputRef(APOLLO_YAML, "buzzer_outputd");
    expect(errorTexts(tmpl)).toHaveLength(0);
    expect(selectInvalid(tmpl)).toBe("");
  });

  it("does not flag a substitution value", () => {
    const tmpl = renderOutputRef(APOLLO_YAML, "${my_output}");
    expect(errorTexts(tmpl)).toHaveLength(0);
  });

  it("does not flag when merged sources could define the id elsewhere", () => {
    const merged = `packages:\n  base: !include common.yaml\n\n${APOLLO_YAML}`;
    expect(errorTexts(renderOutputRef(merged, "buzzer_output"))).toHaveLength(0);
  });

  it("does not flag while the provider fetch is unsettled", () => {
    const tmpl = renderOutputRef(APOLLO_YAML, "buzzer_output", {
      resolveInterfaceProviders: () => null,
    });
    expect(errorTexts(tmpl)).toHaveLength(0);
  });

  it("does not flag when an included value could define the id elsewhere", () => {
    const withInclude = `binary_sensor: !include sensors.yaml\n\n${APOLLO_YAML}`;
    expect(errorTexts(renderOutputRef(withInclude, "buzzer_output"))).toHaveLength(0);
  });

  it("does not flag when a candidate id needs substitution to compare", () => {
    const subbed = APOLLO_YAML.replace("id: buzzer_outputd", "id: ${name}_buzzer");
    expect(errorTexts(renderOutputRef(subbed, "buzzer_output"))).toHaveLength(0);
  });

  it("does not flag when a candidate id uses a bare $name substitution", () => {
    const subbed = APOLLO_YAML.replace("id: buzzer_outputd", "id: $node_buzzer");
    expect(errorTexts(renderOutputRef(subbed, "buzzer_output"))).toHaveLength(0);
  });

  it("yields to a backend error on the same field", () => {
    const tmpl = renderOutputRef(APOLLO_YAML, "buzzer_output", {
      errorAt: () => ({
        key: "output",
        code: "validation.backend",
        params: { message: "backend says no" },
      }),
    });
    const texts = errorTexts(tmpl);
    expect(texts).toHaveLength(1);
    expect(texts[0]).not.toBe("device.id_reference_unknown_error");
  });
});

describe("renderIdReferenceField — id-less configured domain (device-builder#2212)", () => {
  const IDLESS_LOGGER_YAML = "esphome:\n  name: d\nlogger:\n  baud_rate: 115200\n";

  function renderLoggerRef(yaml: string) {
    const entry = makeEntry(ConfigEntryType.STRING, { references_component: "logger" });
    return renderIdReferenceField(
      entry,
      ["logger_id"],
      makeRenderCtx({ logger_id: "" }, { overrides: { yaml } })
    );
  }

  const placeholderOf = (tmpl: unknown): unknown =>
    findElementBindings(tmpl, "wa-select")[0]?.placeholder;

  // The class attribute mixes static text with a binding, so read the solo
  // marker off the template values rather than the extracted bindings.
  const hasSoloAdd = (tmpl: unknown): boolean =>
    findTemplatesByAnchor(tmpl, "<wa-option").some((t) =>
      (t.values as unknown[]).some((v) => v === "id-option-add--solo")
    );

  it("offers Auto instead of claiming no logger is configured", () => {
    const tmpl = renderLoggerRef(IDLESS_LOGGER_YAML);
    expect(placeholderOf(tmpl)).toBe("device.id_reference_auto_configured");
    const values = findElementBindings(tmpl, "wa-option").map((o) => o.value);
    expect(values).toContain(AUTO_SENTINEL);
    expect(values).toContain(ADD_NEW_SENTINEL);
  });

  it("demotes the Add CTA out of its solo styling", () => {
    expect(hasSoloAdd(renderLoggerRef(IDLESS_LOGGER_YAML))).toBe(false);
  });

  it("keeps the empty-state copy and solo Add CTA when the domain is absent", () => {
    const tmpl = renderLoggerRef("esphome:\n  name: d\n");
    expect(placeholderOf(tmpl)).toBe("device.id_reference_empty");
    expect(findElementBindings(tmpl, "wa-option").map((o) => o.value)).not.toContain(
      AUTO_SENTINEL
    );
    expect(hasSoloAdd(tmpl)).toBe(true);
  });

  it("keeps the Add CTA for a required reference (no Auto way out)", () => {
    const entry = makeEntry(ConfigEntryType.STRING, {
      references_component: "logger",
      required: true,
    });
    const tmpl = renderIdReferenceField(
      entry,
      ["logger_id"],
      makeRenderCtx({ logger_id: "" }, { overrides: { yaml: IDLESS_LOGGER_YAML } })
    );
    expect(placeholderOf(tmpl)).toBe("device.id_reference_empty");
    expect(findElementBindings(tmpl, "wa-option").map((o) => o.value)).not.toContain(
      AUTO_SENTINEL
    );
    expect(hasSoloAdd(tmpl)).toBe(true);
  });

  it("selecting Auto emits the empty value (key omitted on save)", () => {
    const ctx = makeRenderCtx(
      { logger_id: "" },
      { overrides: { yaml: IDLESS_LOGGER_YAML } }
    );
    const entry = makeEntry(ConfigEntryType.STRING, { references_component: "logger" });
    const tmpl = renderIdReferenceField(entry, ["logger_id"], ctx);
    const onChange = findElementBindings(tmpl, "wa-select")[0]["@change"] as (
      e: Event
    ) => void;
    onChange({ target: { value: AUTO_SENTINEL } } as unknown as Event);
    expect(ctx.emitChange).toHaveBeenCalledWith(["logger_id"], "");
  });
});

describe("renderIdReferenceField — revert-to-auto option (#2208)", () => {
  const LOGGER_YAML = "logger:\n  baud_rate: 115200\n";

  function renderRef(
    value: string,
    entryOverrides: Partial<Parameters<typeof makeEntry>[1]> = {},
    ctx = makeRenderCtx({ logger_id: value }, { overrides: { yaml: LOGGER_YAML } })
  ) {
    const entry = makeEntry(ConfigEntryType.STRING, {
      references_component: "logger",
      ...entryOverrides,
    });
    return renderIdReferenceField(entry, ["logger_id"], ctx);
  }

  const optionValues = (tmpl: unknown): unknown[] =>
    findElementBindings(tmpl, "wa-option").map((o) => o.value);

  it("offers Auto on an optional reference with a committed value", () => {
    // The dangling `logger_id: logger` older builds pre-filled has no other
    // visual-editor way out.
    expect(optionValues(renderRef("logger"))).toContain(AUTO_SENTINEL);
  });

  it("selecting Auto clears the value (key removed on serialization)", () => {
    const ctx = makeRenderCtx(
      { logger_id: "logger" },
      { overrides: { yaml: LOGGER_YAML } }
    );
    const tmpl = renderRef("logger", {}, ctx);
    const onChange = findElementBindings(tmpl, "wa-select")[0]["@change"] as (
      e: Event
    ) => void;
    onChange({ target: { value: AUTO_SENTINEL } } as unknown as Event);
    expect(ctx.emitChange).toHaveBeenCalledWith(["logger_id"], "");
  });

  it("hides Auto while the field is empty (auto is already the default)", () => {
    // An id'd candidate keeps this on the sole-candidate-placeholder path;
    // the id-less empty state now offers Auto explicitly (device-builder#2212).
    const ctx = makeRenderCtx(
      { logger_id: "" },
      { overrides: { yaml: "logger:\n  id: my_logger\n" } }
    );
    expect(optionValues(renderRef("", {}, ctx))).not.toContain(AUTO_SENTINEL);
  });

  it("hides Auto on a required reference", () => {
    expect(optionValues(renderRef("logger", { required: true }))).not.toContain(
      AUTO_SENTINEL
    );
  });
});
