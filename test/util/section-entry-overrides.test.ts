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
import { ConfigEntryType, type ConfigEntry } from "../../src/api/types.js";
import {
  MAP_SECTIONS,
  resolveSectionEntries,
} from "../../src/util/section-entry-overrides.js";
import { makeConfigEntry } from "../../src/util/config-entry-defaults.js";
import { validateEntries } from "../../src/util/config-validation.js";

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

describe("device-section-config wiring", () => {
  // The section component imports Lit decorators that need DOM
  // globals (vitest runs in ``node``), so we can't render it
  // here. Instead, scan the source for the wiring contract:
  // the form's ``.entries`` prop must bind to the resolver's
  // output, not the catalog's raw ``this._config.entries``.
  //
  // Regression pin: a previous iteration of #160 had
  // ``MAP_SECTIONS`` and the synthesised MAP entries defined in
  // the section component but bound the form's ``.entries``
  // prop directly to the catalog source — leaving the
  // substitutions section silently empty in the UI.
  it("forwards renderEntries / resolveSectionEntries to the form's .entries prop", async () => {
    // tsconfig restricts `types` to @types/w3c-web-serial, so node
    // module specifiers don't type-check; vitest resolves them fine.
    // @ts-ignore — node-only module
    const fs = await import("node:fs");
    // @ts-ignore — node-only module
    const path = await import("node:path");
    // @ts-ignore — node-only module
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const sourcePath = path.resolve(
      here,
      "../../src/components/device/device-section-config.ts"
    );
    const src = fs.readFileSync(sourcePath, "utf-8");

    // The form binding must reference the resolver-derived
    // entries — accept either the local ``renderEntries`` const
    // or a direct ``resolveSectionEntries(...)`` call.
    const entriesBinding = /\.entries\s*=\s*\$\{([^}]+)\}/;
    const match = src.match(entriesBinding);
    expect(match, "form's .entries prop binding is missing").not.toBeNull();
    const expr = match![1].trim();
    expect(
      expr.includes("renderEntries") || expr.includes("resolveSectionEntries"),
      `form's .entries binds to '${expr}', not to the resolver's output`
    ).toBe(true);

    // Pin the inverse too: the catalog source ``this._config.entries``
    // must NOT be the value bound to the form's ``.entries`` prop.
    expect(
      expr.includes("this._config.entries"),
      "form's .entries binds to the raw catalog entries — substitutions override is bypassed"
    ).toBe(false);
  });

  it("routes form-driven validation through the resolver, not the catalog", async () => {
    // Regression pin for the "Save click does nothing" bug on
    // ``packages:`` (and the latent equivalent on
    // ``substitutions:``). The form rendered the resolver's
    // user-keyed MAP shape, but the form's validation ran against
    // the catalog's flat schema — whose required fields (``url``
    // etc. for packages) were absent from the user-named rows, so
    // ``_fieldErrors`` filled up and the save bailed silently.
    // ``validateEntries`` must see the same entries the form
    // rendered.
    //
    // Architecture note: pre-save backend lint (``validateYaml``)
    // is no longer wired into the form. The YAML pane's red
    // squiggles (``yaml-lint-backend.ts``) provide the same lint
    // continuously, and the explicit Validate button runs the
    // full ESPHome compile against the saved file. The "x y is
    // invalid" feedback now flows through those two surfaces.
    // @ts-ignore — node-only module
    const fs = await import("node:fs");
    // @ts-ignore — node-only module
    const path = await import("node:path");
    // @ts-ignore — node-only module
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const sourcePath = path.resolve(
      here,
      "../../src/components/device/device-section-config/draft-and-delete.ts"
    );
    const src = fs.readFileSync(sourcePath, "utf-8");

    const validateCall = /validateEntries\s*\(\s*([^,)]+)\s*,/;
    const match = src.match(validateCall);
    expect(match, "validateEntries call not found").not.toBeNull();
    const firstArg = match![1].trim();
    expect(
      firstArg.includes("renderEntries") || firstArg.includes("resolveSectionEntries"),
      `validateEntries' first arg is '${firstArg}', not the resolver's output`
    ).toBe(true);
    expect(
      firstArg === "this._config.entries",
      "validateEntries reads the raw catalog — MAP-section saves silently bail on the catalog's required fields"
    ).toBe(false);
  });
});

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
