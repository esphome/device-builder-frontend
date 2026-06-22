// @vitest-environment happy-dom
//
// Pins that completion inside an automation action body offers the
// action registry — not the enclosing component's config keys/triggers —
// including at an empty trailing "- ", where the Lezer parse mis-nests
// the dash and the AST-only context check used to fall back to the
// component schema (the zigbee_binary_sensor-under-on_press bug).
import { CompletionContext } from "@codemirror/autocomplete";
import { forceParsing } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComponentCategory } from "../../src/api/types/components.js";
import { _clearComponentCache } from "../../src/util/component-name-cache.js";
import { _resetSchemaCacheForTests } from "../../src/util/esphome-schema.js";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import { createYamlCompletionSource } from "../../src/util/yaml-completion.js";
import { makeComponentEntry } from "./_make-component-entry.js";

const SLIM = [
  makeComponentEntry("esphome", { category: ComponentCategory.CORE }),
  makeComponentEntry("binary_sensor.gpio", { category: ComponentCategory.BINARY_SENSOR }),
  makeComponentEntry("switch.gpio", { category: ComponentCategory.SWITCH }),
];

const fakeApi = {
  getVersion: async () => ({ esphome_version: "2026.5.1" }),
  getComponents: async () => ({ components: SLIM }),
  getComponentBodies: async () => ({}),
  getComponent: async () => null,
} as never;

// The action registry reads each present component's bundle and pulls its
// `action` map (core actions live under the `esphome` bundle's `core`).
function bundleFor(url: string): Response {
  if (url.endsWith("/esphome.json")) {
    // Doubles as the version probe and the core-action bundle.
    return new Response(
      JSON.stringify({ core: { action: { delay: {}, lambda: {}, if: {} } } }),
      { status: 200 }
    );
  }
  if (url.endsWith("/switch.json")) {
    return new Response(
      JSON.stringify({ switch: { action: { turn_on: {}, turn_off: {} } } }),
      { status: 200 }
    );
  }
  return new Response("{}", { status: 200 });
}

async function labelsAt(yaml: string, explicit = false): Promise<string[]> {
  const view = new EditorView({
    state: EditorState.create({ doc: yaml, extensions: [esphomeYaml()] }),
  });
  try {
    forceParsing(view, yaml.length, 60000);
    const ctx = new CompletionContext(view.state, yaml.length, explicit);
    const result = await createYamlCompletionSource(fakeApi)(ctx);
    return (result?.options ?? []).map((o) => o.label);
  } finally {
    view.destroy();
  }
}

const DEVICE = [
  "switch:",
  "  - platform: gpio",
  "    id: relay1",
  "    pin: GPIO33",
  "binary_sensor:",
  "  - platform: gpio",
  "    id: button",
  "    name: Gate",
  "    pin: GPIO34",
  "    on_press:",
  "      then:",
  "        - switch.turn_on: relay1",
];

describe("createYamlCompletionSource (automation action list)", () => {
  beforeEach(() => {
    _clearComponentCache();
    _resetSchemaCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => bundleFor(url))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offers actions, not component keys, at an empty trailing '- ' under then:", async () => {
    const labels = await labelsAt([...DEVICE, "        - "].join("\n"));
    expect(labels).toContain("delay");
    expect(labels).toContain("switch.turn_on");
    // The bug: the enclosing binary_sensor's config keys / triggers leaked in.
    expect(labels).not.toContain("web_server");
    expect(labels).not.toContain("zigbee_binary_sensor");
    expect(labels).not.toContain("on_press");
  });

  it("still offers actions for a partial-key list item (AST path, no regression)", async () => {
    // A non-empty dash parses cleanly, so the AST context check already
    // fires here; assert the fix didn't disturb that path.
    const labels = await labelsAt([...DEVICE, "        - s"].join("\n"));
    expect(labels).toContain("delay");
    expect(labels).toContain("switch.turn_on");
    expect(labels).not.toContain("zigbee_binary_sensor");
  });
});
