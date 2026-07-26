/**
 * Pinning tests for ``resolveSectionEntries`` — the seam the
 * MAP-section render path goes through.
 *
 * A previous iteration of #160 had ``MAP_SECTIONS`` and the
 * synthesised MAP entries in the section component but bound the
 * form's ``.entries`` prop to the *catalog's* entries by mistake —
 * leaving the section silently empty in the UI. Hoisting the
 * resolution into a pure function lets us test "for
 * sectionKey=substitutions/packages, the result IS the synthesised
 * MAP entry, regardless of what the catalog ships" without
 * standing up a Lit shadow root.
 */
import { describe, expect, it } from "vitest";
import { type ConfigEntry, ConfigEntryType } from "../../src/api/types/config-entries.js";
import { YAML_ONLY_SECTIONS } from "../../src/components/device/yaml-only-sections.js";
import { makeConfigEntry } from "../../src/util/config-entry-defaults.js";
import { validateEntries } from "../../src/util/config-validation.js";
import {
  LIST_SECTIONS,
  MAP_SECTIONS,
  resolveSectionEntries,
} from "../../src/util/section-entry-overrides.js";

describe("MAP_SECTIONS", () => {
  it("contains 'substitutions'", () => {
    expect(MAP_SECTIONS.has("substitutions")).toBe(true);
  });

  it("does NOT contain 'packages' (#361 — list shape would corrupt)", () => {
    // ``packages`` accepts both ``{name: pkg}`` and ``[pkg, pkg]``
    // upstream. The dict-only ``renderMapField`` silently
    // overwrote a list-shaped YAML with ``{}`` on save (#361).
    // Routed through ``YAML_ONLY_SECTIONS`` instead so both
    // shapes round-trip cleanly via the YAML pane.
    expect(MAP_SECTIONS.has("packages")).toBe(false);
  });
});

describe("LIST_SECTIONS", () => {
  it("contains 'globals' (top-level list of variable mappings)", () => {
    expect(LIST_SECTIONS.has("globals")).toBe(true);
  });

  it("'globals' is NOT YAML-only and NOT a MAP section", () => {
    expect(YAML_ONLY_SECTIONS.has("globals")).toBe(false);
    expect(MAP_SECTIONS.has("globals")).toBe(false);
  });
});

describe("resolveSectionEntries (LIST section shape)", () => {
  it("globals resolves to one multi_value NESTED entry wrapping the catalog", () => {
    const catalog: ConfigEntry[] = [
      makeConfigEntry({ key: "id", type: ConfigEntryType.STRING }),
      makeConfigEntry({ key: "type", type: ConfigEntryType.STRING }),
    ];
    const entries = resolveSectionEntries("globals", catalog);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("globals");
    expect(entries[0].type).toBe(ConfigEntryType.NESTED);
    expect(entries[0].multi_value).toBe(true);
    expect(entries[0].config_entries).toBe(catalog);
  });

  it("each item card titles read 'Global variable <n>'", () => {
    // labelFor reads entry.label directly, and the nested-list
    // renderer shows ``<label> <n>``.
    const entries = resolveSectionEntries("globals", []);
    expect(entries[0].label).toBe("Global variable");
  });

  it("wraps any LIST_SECTIONS member, defaulting the item label to 'Item'", () => {
    // Genericity pin: the wrap keys off membership, and a member with
    // no LIST_SECTION_ITEM_LABELS entry falls back to "Item".
    const mutable = LIST_SECTIONS as Set<string>;
    mutable.add("future_list_section");
    try {
      const entries = resolveSectionEntries("future_list_section", []);
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe(ConfigEntryType.NESTED);
      expect(entries[0].multi_value).toBe(true);
      expect(entries[0].key).toBe("future_list_section");
      expect(entries[0].label).toBe("Item");
    } finally {
      mutable.delete("future_list_section");
    }
  });
});

describe("resolveSectionEntries — MAP section shape", () => {
  // Each MAP section renders as a single user-keyed-MAP entry
  // whose ``config_entries[0]`` is the value template. The empty
  // key is the "this entry IS the whole values dict" signal the
  // form's ``_renderEntry`` reads to switch to ``path=[]`` for
  // ``ctx.getAt`` / ``ctx.emitChange``. The value template must be
  // a string-shaped entry so primitive values (the common case)
  // get a text input.
  it("substitutions resolves to a single empty-keyed MAP with a required string value template", () => {
    const entries = resolveSectionEntries("substitutions", []);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("");
    expect(entries[0].type).toBe(ConfigEntryType.MAP);
    const valueTemplate = entries[0].config_entries?.[0];
    expect(valueTemplate).toBeDefined();
    expect(valueTemplate!.type).toBe(ConfigEntryType.STRING);
    expect(valueTemplate!.required).toBe(true);
  });
});

describe("resolveSectionEntries", () => {
  it("returns the synthesised MAP entry for substitutions, ignoring the catalog's bogus shape", () => {
    // Regression test: the catalog ships ``substitutions`` with
    // ``[{key: "string", type: "string", advanced: true}]`` (the
    // sync script doesn't honour ``key_type`` at component
    // level). Without this override the section renders ONE
    // advanced text field labelled "String" — the bug from #160.
    const bogusCatalogEntry: ConfigEntry = makeConfigEntry({
      key: "string",
      type: ConfigEntryType.STRING,
      label: "String",
      advanced: true,
    });
    const result = resolveSectionEntries("substitutions", [bogusCatalogEntry]);
    expect(result[0].type).toBe(ConfigEntryType.MAP);
  });

  it("returns the catalog entries unchanged for non-overridden sections", () => {
    const catalogEntries: ConfigEntry[] = [
      makeConfigEntry({ key: "name", required: true }),
      makeConfigEntry({ key: "ssid", required: true }),
    ];
    expect(resolveSectionEntries("wifi", catalogEntries)).toBe(catalogEntries);
  });

  it("returns the catalog entries unchanged for a non-list section", () => {
    const catalogEntries: ConfigEntry[] = [makeConfigEntry({ key: "ssid" })];
    expect(resolveSectionEntries("wifi", catalogEntries)).toBe(catalogEntries);
  });

  it("returns an empty list unchanged for an unknown section that has no entries", () => {
    // The section component falls back to YAML-only when the
    // resolved list is empty; pin that pass-through is faithful.
    expect(resolveSectionEntries("custom_unknown", [])).toEqual([]);
  });

  it("is referentially stable for substitutions (same reference across calls)", () => {
    // The form re-renders on every state change; if the resolver
    // built a new array each time, the form's ``.entries`` prop
    // would change reference and Lit would re-mount the rows.
    // Same reference → no churn.
    const a = resolveSectionEntries("substitutions", []);
    const b = resolveSectionEntries("substitutions", []);
    expect(a).toBe(b);
  });
});

// The component-side wiring (the form's ``.entries`` binding and
// ``flushDraft``'s validation both consuming the resolver) is pinned
// behaviorally in
// ``test/components/device/section-config-entries-wiring.test.ts``.

describe("save validation contract", () => {
  // ``_onSave`` must validate against the *render* schema. Pin
  // the contract directly: a packages-shaped catalog (some
  // required fields the user-keyed rows don't carry) produces
  // errors when validated raw, but no errors once routed through
  // ``resolveSectionEntries`` for a MAP section. Same shape that
  // bit ``substitutions`` latently and ``packages`` visibly.
  it("validateEntries against the resolver's output accepts user-keyed values that the raw catalog would reject", () => {
    const packagesShapedCatalog: ConfigEntry[] = [
      makeConfigEntry({
        key: "url",
        type: ConfigEntryType.STRING,
        required: true,
      }),
      makeConfigEntry({
        key: "ref",
        type: ConfigEntryType.STRING,
        required: false,
      }),
    ];
    const userKeyedValues: Record<string, unknown> = {
      ApolloAutomation: "github://example/repo",
      new_1: "github://example/other",
    };

    // Buggy path (validate against catalog): ``url`` reports
    // required, so ``_fieldErrors`` populates and the save bails.
    const rawErrors = validateEntries(packagesShapedCatalog, userKeyedValues);
    expect(rawErrors.has("url")).toBe(true);

    // Fixed path (validate against resolver output): the single
    // user-keyed MAP entry isn't required, so no errors and the
    // save proceeds.
    const resolved = resolveSectionEntries("substitutions", packagesShapedCatalog);
    const resolvedErrors = validateEntries(resolved, userKeyedValues);
    expect(resolvedErrors.size).toBe(0);
  });

  it("non-MAP sections still see catalog requirements (the resolver is a pass-through)", () => {
    // Sanity check: the fix doesn't accidentally suppress
    // validation for non-MAP sections. For ``wifi`` the resolver
    // hands the catalog back unchanged, so a missing required
    // ``ssid`` still errors.
    const wifiCatalog: ConfigEntry[] = [
      makeConfigEntry({
        key: "ssid",
        type: ConfigEntryType.STRING,
        required: true,
      }),
    ];
    const errors = validateEntries(resolveSectionEntries("wifi", wifiCatalog), {});
    expect(errors.has("ssid")).toBe(true);
  });
});
