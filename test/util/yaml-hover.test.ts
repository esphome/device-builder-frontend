import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import type { ComponentCatalogEntry } from "../../src/api/types/components.js";
import { ConfigEntryType, type ConfigEntry } from "../../src/api/types/config-entries.js";
import { fetchComponent } from "../../src/util/component-name-cache.js";
import * as schema from "../../src/util/esphome-schema.js";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import type { CatalogIndex } from "../../src/util/yaml-completion.js";
import { resolveHoverTarget } from "../../src/util/yaml-hover.js";

// Stub the network-backed schema lookups; keep the rest of the module
// (bundleFor consumers, parse helpers) real.
vi.mock("../../src/util/esphome-schema.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/util/esphome-schema.js")>()),
  getComponentDocs: vi.fn(),
  getConfigVarValueOptions: vi.fn(),
  getActions: vi.fn(),
  getTriggerKeys: vi.fn(),
  getRegistryEntries: vi.fn(),
  lookupRegistryRef: vi.fn(),
  getConfigVarDocsAtPath: vi.fn(),
}));

// The hover gate reads each component's `config_entries` to decide whether
// the structured editor already renders a form for it.
vi.mock("../../src/util/component-name-cache.js", () => ({
  fetchComponent: vi.fn(),
}));

function comp(c: Partial<ComponentCatalogEntry>): ComponentCatalogEntry {
  return { config_entries: [], ...c } as unknown as ComponentCatalogEntry;
}
function field(f: Partial<ConfigEntry>): ConfigEntry {
  return f as unknown as ConfigEntry;
}

// Components the structured editor renders a form for (non-empty
// `config_entries`). Everything else resolves as YAML-only → hover shown.
const FORM_BACKED: Record<string, ConfigEntry[]> = {
  esphome: [field({ key: "name" })],
  wifi: [field({ key: "ssid" })],
  "binary_sensor.gpio": [field({ key: "pin" })],
};

// The slim catalog passed to the resolver — used for component / field
// descriptions once a token clears the gate. `ethernet` is YAML-only.
const CATALOG: CatalogIndex = {
  components: [],
  byCategory: new Map(),
  byId: new Map<string, ComponentCatalogEntry>([
    [
      "ethernet",
      comp({
        id: "ethernet",
        name: "Ethernet",
        description: "Wired networking for the node.",
        docs_url: "https://esphome.io/components/ethernet",
        config_entries: [
          field({
            key: "type",
            type: ConfigEntryType.STRING,
            description: "The Ethernet chip type.",
            help_link: "https://esphome.io/components/ethernet#type",
          }),
        ],
      }),
    ],
  ]),
};

const API = {} as unknown as ESPHomeAPI;

function stateFor(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [esphomeYaml()] });
  ensureSyntaxTree(state, state.doc.length);
  return state;
}
function posOf(doc: string, token: string): number {
  const idx = doc.indexOf(token);
  if (idx < 0) throw new Error(`token not found: ${token}`);
  return idx + 1;
}
function hover(doc: string, token: string) {
  return resolveHoverTarget(stateFor(doc), posOf(doc, token), API, CATALOG);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(schema.getComponentDocs).mockResolvedValue(null);
  vi.mocked(schema.getConfigVarValueOptions).mockResolvedValue([]);
  vi.mocked(schema.getActions).mockResolvedValue([]);
  vi.mocked(schema.getTriggerKeys).mockResolvedValue([]);
  vi.mocked(schema.getRegistryEntries).mockResolvedValue([]);
  vi.mocked(schema.lookupRegistryRef).mockResolvedValue(null);
  vi.mocked(schema.getConfigVarDocsAtPath).mockResolvedValue(null);
  vi.mocked(fetchComponent).mockImplementation((_api, id) =>
    Promise.resolve(comp({ id, config_entries: FORM_BACKED[id] ?? [] }))
  );
});

describe("resolveHoverTarget — gated to YAML-only components", () => {
  it("returns null on a comment line", async () => {
    expect(await hover("# just a comment\nethernet:\n", "comment")).toBeNull();
  });

  // ─── Suppressed: the structured editor already documents these ───

  it("suppresses a top-level component that has a form", async () => {
    expect(await hover("wifi:\n  ssid: x\n", "wifi")).toBeNull();
  });

  it("suppresses a nested key inside a form-backed platform component", async () => {
    const doc = "binary_sensor:\n  - platform: gpio\n    pin:\n      inverted: false\n";
    expect(await hover(doc, "inverted")).toBeNull();
  });

  it("suppresses an enum value inside a form-backed component", async () => {
    vi.mocked(schema.getConfigVarValueOptions).mockResolvedValue([
      { value: "garage_door", docs: "Garage door class." },
    ]);
    const doc = "binary_sensor:\n  - platform: gpio\n    device_class: garage_door\n";
    expect(await hover(doc, "garage_door")).toBeNull();
  });

  it("suppresses a platform value for a form-backed platform component", async () => {
    const doc = "binary_sensor:\n  - platform: gpio\n    name: x\n";
    expect(await hover(doc, "gpio")).toBeNull();
  });

  it("suppresses an automation action inside a form-backed component", async () => {
    vi.mocked(schema.getActions).mockResolvedValue([
      { key: "logger.log", docs: "Log a message." },
    ]);
    const doc = 'esphome:\n  on_boot:\n    then:\n      - logger.log: "hi"\n';
    expect(await hover(doc, "logger.log")).toBeNull();
  });

  // ─── Shown: components the structured editor can't render a form for ───

  it("shows the component description for a YAML-only component", async () => {
    const target = await hover("ethernet:\n  type: W5500\n", "ethernet");
    expect(target?.description).toBe("Wired networking for the node.");
    expect(target?.docsUrl).toBe("https://esphome.io/components/ethernet");
  });

  it("does not throw when the component body omits config_entries", async () => {
    // ethernet's real body has no `config_entries` key at all (not [] —
    // absent). The gate must optional-chain it, not crash the hover.
    vi.mocked(fetchComponent).mockResolvedValue({
      id: "ethernet",
      name: "Ethernet",
    } as unknown as ComponentCatalogEntry);
    const target = await hover("ethernet:\n  type: W5500\n", "ethernet");
    expect(target?.description).toBe("Wired networking for the node.");
  });

  it("walks the schema for a nested key in a YAML-only component", async () => {
    vi.mocked(schema.getConfigVarDocsAtPath).mockResolvedValue("The Ethernet chip type.");
    const target = await hover("ethernet:\n  type: W5500\n", "type");
    expect(target?.description).toBe("The Ethernet chip type.");
    expect(vi.mocked(schema.getConfigVarDocsAtPath)).toHaveBeenCalledWith(
      API,
      "ethernet",
      "ethernet",
      ["type"]
    );
  });

  it("falls back to the catalog field description for a YAML-only component", async () => {
    const target = await hover("ethernet:\n  type: W5500\n", "type");
    expect(target?.description).toBe("**string**: The Ethernet chip type.");
    expect(target?.docsUrl).toBe("https://esphome.io/components/ethernet#type");
  });

  it("shows a bare-domain description for a platform domain with no form", async () => {
    vi.mocked(schema.getComponentDocs).mockResolvedValue(
      "With ESPHome you can use different types of binary sensors."
    );
    const target = await hover("binary_sensor:\n  - platform: gpio\n", "binary_sensor");
    expect(target?.description).toBe(
      "With ESPHome you can use different types of binary sensors."
    );
  });
});
