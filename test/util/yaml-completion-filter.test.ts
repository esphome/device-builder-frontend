// @vitest-environment happy-dom
import { CompletionContext } from "@codemirror/autocomplete";
import { forceParsing } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComponentCategory } from "../../src/api/types/components.js";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { _clearComponentCache } from "../../src/util/component-name-cache.js";
import { _resetSchemaCacheForTests } from "../../src/util/esphome-schema.js";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import { createYamlCompletionSource } from "../../src/util/yaml-completion.js";
import { makeComponentEntry } from "./_make-component-entry.js";
import { makeConfigEntry, makeNestedEntry as nested } from "./_make-config-entry.js";

const SLIM = [
  ...["esphome", "wifi", "logger", "esp32"].map((id) =>
    makeComponentEntry(id, { category: ComponentCategory.CORE })
  ),
  makeComponentEntry("sensor.template", { category: ComponentCategory.SENSOR }),
];

const BODIES: Record<
  string,
  { id: string; config_entries: ReturnType<typeof makeConfigEntry>[] }
> = {
  esphome: {
    id: "esphome",
    config_entries: [
      makeConfigEntry({ key: "name" }),
      makeConfigEntry({ key: "friendly_name" }),
      makeConfigEntry({ key: "comment" }),
    ],
  },
  esp32: {
    id: "esp32",
    config_entries: [
      nested("framework", [
        makeConfigEntry({
          key: "advanced",
          type: ConfigEntryType.NESTED,
          config_entries: [
            makeConfigEntry({ key: "verbose", type: ConfigEntryType.BOOLEAN }),
          ],
        }),
        makeConfigEntry({ key: "version" }),
        makeConfigEntry({ key: "sdkconfig_options", hidden: true }),
      ]),
    ],
  },
  "sensor.template": {
    id: "sensor.template",
    config_entries: [
      makeConfigEntry({ key: "name" }),
      makeConfigEntry({ key: "lambda" }),
      makeConfigEntry({ key: "update_interval" }),
    ],
  },
};

const fakeApi = {
  getComponents: async () => ({ components: SLIM }),
  getComponentBodies: async (ids: string[]) =>
    Object.fromEntries(ids.filter((id) => id in BODIES).map((id) => [id, BODIES[id]])),
  getComponent: async () => null,
} as never;

async function labelsAt(
  yaml: string,
  explicit = false,
  pos = yaml.length
): Promise<string[]> {
  // Drive a real view + full parse so the AST helpers see the same tree a
  // live editor does (a bare state parses lazily and misses the cursor's tail).
  const view = new EditorView({
    state: EditorState.create({ doc: yaml, extensions: [esphomeYaml()] }),
  });
  try {
    forceParsing(view, yaml.length, 60000);
    const ctx = new CompletionContext(view.state, pos, explicit);
    const result = await createYamlCompletionSource(fakeApi)(ctx);
    return (result?.options ?? []).map((o) => o.label);
  } finally {
    view.destroy();
  }
}

describe("createYamlCompletionSource (already-set key filtering)", () => {
  beforeEach(() => {
    _clearComponentCache();
    _resetSchemaCacheForTests();
    // Keep the schema-bundle providers hermetic — they shouldn't fire
    // here (the catalog answers every position), but stub fetch so a
    // stray call resolves to an empty bundle instead of hitting the net.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("drops nested keys already set in the mapping", async () => {
    const labels = await labelsAt(["esphome:", "  name: foo", "  c"].join("\n"));
    expect(labels).not.toContain("name");
    expect(labels).toContain("friendly_name");
    expect(labels).toContain("comment");
  });

  it("drops top-level blocks already present", async () => {
    const labels = await labelsAt(
      ["esphome:", "  name: foo", "wifi:", "  ssid: x", "e"].join("\n")
    );
    expect(labels).not.toContain("esphome");
    expect(labels).not.toContain("wifi");
    expect(labels).toContain("logger");
    expect(labels).toContain("esp32");
  });

  it("completes nested-mapping keys (esp32 framework), the missing-suggestions case", async () => {
    const labels = await labelsAt(
      ["esp32:", "  board: esp32-poe-iso", "  framework:", "    a"].join("\n")
    );
    expect(labels).toContain("advanced");
    expect(labels).toContain("version");
  });

  it("keeps yaml_only (hidden) fields in YAML key completion", async () => {
    // ``hidden`` mirrors upstream ``visibility: yaml_only`` (hide from the
    // visual form); YAML completion is exactly where those must appear.
    const labels = await labelsAt(
      ["esp32:", "  board: esp32-poe-iso", "  framework:", "    s"].join("\n")
    );
    expect(labels).toContain("sdkconfig_options");
  });

  it("offers nested keys on a blank indented line when triggered explicitly (idle)", async () => {
    // The caret rests on a blank line under ``framework:`` with no partial;
    // an explicit (idle) trigger must still surface the framework fields.
    const labels = await labelsAt(["esp32:", "  framework:", "    "].join("\n"), true);
    expect(labels).toContain("advanced");
    expect(labels).toContain("version");
  });

  it("filters already-set siblings on a blank indented line", async () => {
    // The AST can't read siblings on a blank line; an indent scan must still
    // drop a key already set in the mapping (``version`` here).
    const labels = await labelsAt(
      ["esp32:", "  framework:", "    version: 5.0", "    "].join("\n"),
      true
    );
    expect(labels).toContain("advanced");
    expect(labels).not.toContain("version");
  });

  it("offers each list item's own fields without cross-item filtering", async () => {
    // Two ``- platform: template`` sensors: ``name`` is set in the first
    // item only, so the second item must still offer it (list items are
    // separate mappings), along with the rest of the platform's fields.
    const labels = await labelsAt(
      [
        "sensor:",
        "  - platform: template",
        "    name: First",
        "  - platform: template",
        "    n",
      ].join("\n")
    );
    expect(labels).toContain("name");
    expect(labels).toContain("lambda");
    expect(labels).toContain("update_interval");
  });

  it("filters a key already set within the same list item", async () => {
    const labels = await labelsAt(
      ["sensor:", "  - platform: template", "    name: Second", "    u"].join("\n")
    );
    expect(labels).not.toContain("name");
    expect(labels).toContain("update_interval");
  });

  it("completes a value inside a deeply nested mapping", async () => {
    // Value position two levels deep (``framework: advanced: verbose:``)
    // exercises the value-position nested descent end to end.
    const labels = await labelsAt(
      ["esp32:", "  framework:", "    advanced:", "      verbose: t"].join("\n")
    );
    expect(labels).toEqual(["true", "false"]);
  });

  it("completes a nested value at a trailing space (empty partial)", async () => {
    // Cursor after ``verbose: `` with no value typed yet: the empty value
    // resolves to the document root, so getKeyPath re-anchors on the line to
    // still surface the options instead of going silent.
    const labels = await labelsAt(
      ["esp32:", "  framework:", "    advanced:", "      verbose: "].join("\n")
    );
    expect(labels).toEqual(["true", "false"]);
  });

  it("completes a trailing-space value mid-document (idle popup case)", async () => {
    // Same shape with content below the caret: the whitespace resolves into
    // an enclosing container instead of the root, so the re-anchor must fire
    // for the idle popup to surface options.
    const head = ["esp32:", "  framework:", "    advanced:", "      verbose: "].join(
      "\n"
    );
    const doc = head + "\n" + ["wifi:", "  ssid: x"].join("\n");
    expect(await labelsAt(doc, true, head.length)).toEqual(["true", "false"]);
  });

  it("auto-offers platform at a fresh list-item dash (no partial typed)", async () => {
    // Typing ``- `` under a platform domain should immediately offer
    // ``platform:`` rather than wait for a partial or ctrl-space.
    const labels = await labelsAt(["sensor:", "  - "].join("\n"));
    expect(labels).toContain("platform");
  });
});
