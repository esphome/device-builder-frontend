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
import { _clearCatalogCache } from "../../src/util/yaml-completion-catalog.js";
import { createYamlCompletionSource } from "../../src/util/yaml-completion.js";
import { makeComponentEntry } from "./_make-component-entry.js";
import { makeConfigEntry } from "./_make-config-entry.js";

// ``my_light.output`` needs a float output. The index marks the ``gpio``
// output as binary only, so autocomplete must offer ``pwm_out`` alone, the
// same verdict the visual picker reaches from the same catalog index.
const lightBody = makeComponentEntry("my_light", {
  category: ComponentCategory.MISC,
  config_entries: [
    makeConfigEntry({
      key: "output",
      type: ConfigEntryType.ID,
      references_component: "output",
      references_class: "output::FloatOutput",
    }),
  ],
});
const index = [
  makeComponentEntry("my_light", { category: ComponentCategory.MISC }),
  makeComponentEntry("output.gpio", { id_classes: ["output::BinaryOutput"] }),
  makeComponentEntry("output.ledc"),
];

const fakeApi = {
  getComponents: async () => ({ components: index }),
  getComponentBodies: async (ids: string[]) =>
    Object.fromEntries(
      ids.filter((id) => id === "my_light").map((id) => [id, lightBody])
    ),
  getVersion: async () => ({ server_version: "0.0.0", esphome_version: "2026.9.0" }),
  getComponent: async () => null,
} as unknown as ESPHomeAPI;

async function complete(yaml: string) {
  const state = EditorState.create({ doc: yaml, extensions: [esphomeYaml()] });
  const ctx = new CompletionContext(state, yaml.length, false);
  return createYamlCompletionSource(fakeApi)(ctx);
}

describe("createYamlCompletionSource (class-restricted ID reference)", () => {
  beforeEach(() => {
    _clearCatalogCache();
    _clearComponentCache();
    _clearScanMemos();
    _resetSchemaCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _clearCatalogCache();
  });

  it("offers only the ids whose block can provide the required class", async () => {
    const yaml = [
      "output:",
      "  - platform: gpio",
      "    id: relay_out",
      "  - platform: ledc",
      "    id: pwm_out",
      "my_light:",
      "  output: ",
    ].join("\n");
    const labels = ((await complete(yaml))?.options ?? []).map((o) => o.label);
    expect(labels).toEqual(["pwm_out"]);
  });
});
