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
  it("contains 'substitutions' and 'packages'", () => {
    expect(MAP_SECTIONS.has("substitutions")).toBe(true);
    expect(MAP_SECTIONS.has("packages")).toBe(true);
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
  it.each(["substitutions", "packages"])(
    "%s resolves to a single empty-keyed MAP with a required string value template",
    (sectionKey) => {
      const entries = resolveSectionEntries(sectionKey, []);
      expect(entries).toHaveLength(1);
      expect(entries[0].key).toBe("");
      expect(entries[0].type).toBe(ConfigEntryType.MAP);
      const valueTemplate = entries[0].config_entries?.[0];
      expect(valueTemplate).toBeDefined();
      expect(valueTemplate!.type).toBe(ConfigEntryType.STRING);
      expect(valueTemplate!.required).toBe(true);
    },
  );
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
    expect(result).not.toBe([bogusCatalogEntry]);
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

  it.each(["substitutions", "packages"])(
    "is referentially stable for %s (same reference across calls)",
    (sectionKey) => {
      // The form re-renders on every state change; if the resolver
      // built a new array each time, the form's ``.entries`` prop
      // would change reference and Lit would re-mount the rows.
      // Same reference → no churn.
      const a = resolveSectionEntries(sectionKey, []);
      const b = resolveSectionEntries(sectionKey, []);
      expect(a).toBe(b);
    },
  );

  it("hands packages a different value template than substitutions", () => {
    // Packages uses a stricter template (pattern-validated source
    // shorthand) so the two MAP sections must NOT alias the same
    // synthesised entry — otherwise editing one section's pattern
    // would silently change the other's validation.
    const subs = resolveSectionEntries("substitutions", []);
    const pkgs = resolveSectionEntries("packages", []);
    expect(subs).not.toBe(pkgs);
    const subsTemplate = subs[0].config_entries?.[0];
    const pkgsTemplate = pkgs[0].config_entries?.[0];
    expect(subsTemplate!.pattern).toBeNull();
    expect(pkgsTemplate!.pattern).not.toBeNull();
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
    // ``tsconfig.json`` restricts ``types`` to ``@types/w3c-web-serial``
    // for the production build, so ``@types/node`` isn't visible to
    // ``tsc`` even though it's installed for runtime use. Skip the
    // type check for these node-only imports — the test runs in
    // vitest's node environment where they resolve fine.
    // @ts-expect-error — node-only module, types excluded from tsconfig
    const fs = await import("node:fs");
    // @ts-expect-error — node-only module, types excluded from tsconfig
    const path = await import("node:path");
    // @ts-expect-error — node-only module, types excluded from tsconfig
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const sourcePath = path.resolve(
      here,
      "../../src/components/device/device-section-config.ts",
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
      `form's .entries binds to '${expr}', not to the resolver's output`,
    ).toBe(true);

    // Pin the inverse too: the catalog source ``this._config.entries``
    // must NOT be the value bound to the form's ``.entries`` prop.
    expect(
      expr.includes("this._config.entries"),
      "form's .entries binds to the raw catalog entries — substitutions override is bypassed",
    ).toBe(false);
  });

  it("routes _onSave's validateEntries through the resolver, not the catalog", async () => {
    // Regression pin for the "Save click does nothing" bug on
    // ``packages:`` (and the latent equivalent on
    // ``substitutions:``). The form rendered the resolver's
    // user-keyed MAP shape, but ``_onSave`` validated against the
    // catalog's flat schema — whose required fields (``url`` etc.
    // for packages) were absent from the user-named rows, so
    // ``_fieldErrors`` filled up and the save bailed silently.
    // ``validateEntries`` must see the same entries the form
    // rendered.
    // @ts-expect-error — node-only module, types excluded from tsconfig
    const fs = await import("node:fs");
    // @ts-expect-error — node-only module, types excluded from tsconfig
    const path = await import("node:path");
    // @ts-expect-error — node-only module, types excluded from tsconfig
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const sourcePath = path.resolve(
      here,
      "../../src/components/device/device-section-config.ts",
    );
    const src = fs.readFileSync(sourcePath, "utf-8");

    const validateCall = /validateEntries\s*\(\s*([^,)]+)\s*,/;
    const match = src.match(validateCall);
    expect(match, "validateEntries call not found").not.toBeNull();
    const firstArg = match![1].trim();
    expect(
      firstArg.includes("renderEntries") ||
        firstArg.includes("resolveSectionEntries"),
      `validateEntries' first arg is '${firstArg}', not the resolver's output`,
    ).toBe(true);
    expect(
      firstArg === "this._config.entries",
      "validateEntries reads the raw catalog — MAP-section saves silently bail on the catalog's required fields",
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
    const rawErrors = validateEntries(
      packagesShapedCatalog,
      userKeyedValues,
    );
    expect(rawErrors.has("url")).toBe(true);

    // Fixed path (validate against resolver output): the single
    // user-keyed MAP entry isn't required, so no errors and the
    // save proceeds.
    const resolved = resolveSectionEntries(
      "substitutions",
      packagesShapedCatalog,
    );
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
    const errors = validateEntries(
      resolveSectionEntries("wifi", wifiCatalog),
      {},
    );
    expect(errors.has("ssid")).toBe(true);
  });
});

describe("packages source pattern", () => {
  // The visible bug: a user types ``x y`` (a value with whitespace
  // — never a valid git shorthand) into a ``packages:`` row, hits
  // Save, and the form lets it through. ESPHome's loader then
  // rejects the config with "URL is not in expected format!" at
  // compile time. The fix routes per-row values through the
  // packages value template's ``pattern`` (mirrors ESPHome's
  // ``GitFile.from_shorthand`` regex) so the form catches obvious
  // typos before save.
  const pkgEntries = resolveSectionEntries("packages", []);

  it("rejects a value containing whitespace (the reported `x y` case)", () => {
    const errors = validateEntries(pkgEntries, {
      ApolloAutomation: "x y",
    });
    expect(errors.size).toBe(1);
    expect(errors.get("ApolloAutomation")?.code).toBe(
      "validation.invalid_package_source",
    );
  });

  it.each([
    ["bare-string", "xyz"],
    ["wrong-protocol", "https://example.com/repo/file.yaml"],
    ["unknown-domain", "bitbucket://owner/repo/file.yaml"],
    ["empty-after-protocol", "github://"],
  ])("rejects %s (`%s`)", (_label, value) => {
    const errors = validateEntries(pkgEntries, { row: value });
    expect(errors.has("row")).toBe(true);
  });

  it.each([
    ["github short", "github://owner/repo/file.yaml"],
    ["github with subfolder", "github://owner/repo/sub/dir/file.yaml"],
    ["github with ref", "github://owner/repo/file.yaml@main"],
    [
      "github with ref containing dots",
      "github://owner/repo/file.yaml@v1.2.3",
    ],
    ["gitlab short", "gitlab://owner/repo/file.yaml"],
    [
      "ApolloAutomation real-world example",
      "github://ApolloAutomation/PLT-1/Integrations/ESPHome/PLT-1_Minimal.yaml",
    ],
  ])("accepts %s (`%s`)", (_label, value) => {
    const errors = validateEntries(pkgEntries, { row: value });
    expect(errors.size).toBe(0);
  });

  it("skips the pattern check for complex (object) row values", () => {
    // Packages rows can be a YAML mapping (``url:`` + ``ref:`` +
    // ``files:`` …) instead of a shorthand string. Those bypass
    // the value template's input via ``renderMapField``'s
    // "edit in YAML" placeholder, so validating them against the
    // string-shape pattern is a category error. Pin that the
    // recursion skips them.
    const errors = validateEntries(pkgEntries, {
      row: { url: "https://example.com/repo.git", ref: "main" },
    });
    expect(errors.size).toBe(0);
  });

  it("substitutions doesn't apply the packages pattern (its values are arbitrary strings)", () => {
    // Substitutions accepts any string (per ESPHome's
    // ``cv.Schema({validate_substitution_key: object})``). Pin
    // that the pattern is a per-section override, not a leak from
    // packages back onto substitutions.
    const subEntries = resolveSectionEntries("substitutions", []);
    const errors = validateEntries(subEntries, {
      ssid_default: "x y has spaces and that's fine",
    });
    expect(errors.size).toBe(0);
  });
});
