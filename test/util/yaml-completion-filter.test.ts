import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComponentCategory } from "../../src/api/types/components.js";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { _clearComponentCache } from "../../src/util/component-name-cache.js";
import { _resetSchemaCacheForTests } from "../../src/util/esphome-schema.js";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import { createYamlCompletionSource } from "../../src/util/yaml-completion.js";
import { makeComponentEntry } from "./_make-component-entry.js";
import { makeConfigEntry } from "./_make-config-entry.js";

const nested = (key: string, children: ReturnType<typeof makeConfigEntry>[]) =>
  makeConfigEntry({ key, type: ConfigEntryType.NESTED, config_entries: children });

const SLIM = ["esphome", "wifi", "logger", "esp32"].map((id) =>
  makeComponentEntry(id, { category: ComponentCategory.CORE })
);

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
          config_entries: [],
        }),
        makeConfigEntry({ key: "version" }),
      ]),
    ],
  },
};

const fakeApi = {
  getComponents: async () => ({ components: SLIM }),
  getComponentBodies: async (ids: string[]) =>
    Object.fromEntries(ids.filter((id) => id in BODIES).map((id) => [id, BODIES[id]])),
  getComponent: async () => null,
} as never;

async function labelsAt(yaml: string): Promise<string[]> {
  const state = EditorState.create({ doc: yaml, extensions: [esphomeYaml()] });
  const ctx = new CompletionContext(state, yaml.length, false);
  const result = await createYamlCompletionSource(fakeApi)(ctx);
  return (result?.options ?? []).map((o) => o.label);
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
});
