// @vitest-environment happy-dom

import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { ComponentCategory } from "../../src/api/types/components.js";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { _clearComponentCache } from "../../src/util/component-name-cache.js";
import { _clearScanMemos } from "../../src/util/config-entry-yaml-scan.js";
import { _resetSchemaCacheForTests } from "../../src/util/esphome-schema.js";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import { createYamlCompletionSource } from "../../src/util/yaml-completion.js";
import { makeComponentEntry } from "./_make-component-entry.js";
import { makeConfigEntry } from "./_make-config-entry.js";

// A component carrying an ID-reference field (``ref_field`` points at the
// ``i2c`` domain) and a plain declaring ``id`` field (no
// ``references_component``). The completion source should suggest declared
// i2c IDs for the former and leave the latter untouched.
//
// The slim ``getComponents`` index lists the component but carries no
// ``config_entries``; the field tree hydrates through
// ``getComponentBodies`` — mirror that split here.
const componentBody = makeComponentEntry("my_comp", {
  category: ComponentCategory.MISC,
  config_entries: [
    makeConfigEntry({
      key: "ref_field",
      type: ConfigEntryType.ID,
      references_component: "i2c",
    }),
    makeConfigEntry({ key: "id", type: ConfigEntryType.ID }),
  ],
});
const catalogComponent = makeComponentEntry("my_comp", {
  category: ComponentCategory.MISC,
});

const fakeApi = {
  getComponents: async () => ({ components: [catalogComponent] }),
  getComponentBodies: async (ids: string[]) =>
    Object.fromEntries(
      ids.filter((id) => id === "my_comp").map((id) => [id, componentBody])
    ),
  getVersion: async () => ({ server_version: "0.0.0", esphome_version: "2026.5.0" }),
  getComponent: async () => null,
} as unknown as ESPHomeAPI;

async function complete(yaml: string) {
  const state = EditorState.create({ doc: yaml, extensions: [esphomeYaml()] });
  const source = createYamlCompletionSource(fakeApi);
  const ctx = new CompletionContext(state, yaml.length, false);
  return source(ctx);
}

describe("createYamlCompletionSource (ID-reference completion)", () => {
  beforeEach(() => {
    _clearComponentCache();
    _clearScanMemos();
    _resetSchemaCacheForTests();
    // Schema-bundle fallback (the path declaring-``id`` falls through to)
    // must not hit the network — return an empty bundle so it yields no
    // enum values and the source resolves to null.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("suggests declared IDs of the referenced domain", async () => {
    const yaml = [
      "i2c:",
      "  - id: bus_a",
      "  - id: bus_b",
      "my_comp:",
      "  ref_field: ",
    ].join("\n");
    const result = await complete(yaml);
    expect(result).not.toBeNull();
    const labels = (result?.options ?? []).map((o) => o.label).sort();
    expect(labels).toEqual(["bus_a", "bus_b"]);
  });

  it("keeps returning the candidate list as a partial is typed", async () => {
    const yaml = ["i2c:", "  - id: bus_a", "my_comp:", "  ref_field: bus_"].join("\n");
    const result = await complete(yaml);
    expect(result).not.toBeNull();
    const labels = (result?.options ?? []).map((o) => o.label);
    expect(labels).toContain("bus_a");
  });

  it("does not suggest IDs for a declaring ``id:`` field", async () => {
    const yaml = ["i2c:", "  - id: bus_a", "my_comp:", "  id: "].join("\n");
    const result = await complete(yaml);
    const labels = (result?.options ?? []).map((o) => o.label);
    expect(labels).not.toContain("bus_a");
  });

  it("falls through when the referenced domain declares no IDs", async () => {
    const yaml = ["my_comp:", "  ref_field: "].join("\n");
    const result = await complete(yaml);
    expect(result).toBeNull();
  });
});
