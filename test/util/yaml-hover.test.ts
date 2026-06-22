import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import type { ComponentCatalogEntry } from "../../src/api/types/components.js";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import * as schema from "../../src/util/esphome-schema.js";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import type { CatalogIndex } from "../../src/util/yaml-completion.js";
import { resolveHoverTarget } from "../../src/util/yaml-hover.js";
import { makeComponentEntry } from "./_make-component-entry.js";
import { makeConfigEntry } from "./_make-config-entry.js";

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

// Build the slim catalog index the resolver consumes — used for
// component / field descriptions once the schema walk comes up empty.
function catalog(entries: ComponentCatalogEntry[]): CatalogIndex {
  const byId = new Map<string, ComponentCatalogEntry>();
  const byCategory = new Map<string, ComponentCatalogEntry[]>();
  for (const e of entries) {
    byId.set(e.id, e);
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }
  return { components: entries, byId, byCategory };
}

const CATALOG: CatalogIndex = catalog([
  makeComponentEntry("ethernet", {
    name: "Ethernet",
    description: "Wired networking for the node.",
    docs_url: "https://esphome.io/components/ethernet",
    config_entries: [
      makeConfigEntry({
        key: "type",
        type: ConfigEntryType.STRING,
        description: "The Ethernet chip type.",
        help_link: "https://esphome.io/components/ethernet#type",
      }),
    ],
  }),
  makeComponentEntry("binary_sensor.gpio", {
    name: "GPIO Binary Sensor",
    description: "A binary sensor reading a GPIO pin.",
    docs_url: "https://esphome.io/components/binary_sensor/gpio",
  }),
]);

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
});

describe("resolveHoverTarget — docs on every documented key (legacy parity)", () => {
  it("returns null on a comment line", async () => {
    expect(await hover("# just a comment\nethernet:\n", "comment")).toBeNull();
  });

  // ─── Form-editable components get docs too — no longer suppressed ───

  it("shows the component docs for a top-level component that has a form", async () => {
    vi.mocked(schema.getComponentDocs).mockResolvedValue("WiFi connection settings.");
    const target = await hover("wifi:\n  ssid: x\n", "wifi");
    expect(target?.description).toBe("WiFi connection settings.");
  });

  it("shows schema docs for a nested key inside a form-backed platform component", async () => {
    vi.mocked(schema.getConfigVarDocsAtPath).mockResolvedValue(
      "Invert the reported state."
    );
    const doc = "binary_sensor:\n  - platform: gpio\n    pin:\n      inverted: false\n";
    const target = await hover(doc, "inverted");
    expect(target?.description).toBe("Invert the reported state.");
  });

  it("shows an enum value's meaning inside a form-backed component", async () => {
    vi.mocked(schema.getConfigVarValueOptions).mockResolvedValue([
      { value: "garage_door", docs: "Garage door class." },
    ]);
    const doc = "binary_sensor:\n  - platform: gpio\n    device_class: garage_door\n";
    const target = await hover(doc, "garage_door");
    expect(target?.description).toBe("Garage door class.");
  });

  it("shows the platform value description for a form-backed platform component", async () => {
    const doc = "binary_sensor:\n  - platform: gpio\n    name: x\n";
    const target = await hover(doc, "gpio");
    expect(target?.description).toBe("A binary sensor reading a GPIO pin.");
    expect(target?.docsUrl).toBe("https://esphome.io/components/binary_sensor/gpio");
  });

  it("shows an automation action's docs inside a form-backed component", async () => {
    vi.mocked(schema.getActions).mockResolvedValue([
      { key: "logger.log", docs: "Log a message." },
    ]);
    const doc = 'esphome:\n  on_boot:\n    then:\n      - logger.log: "hi"\n';
    const target = await hover(doc, "logger.log");
    expect(target?.description).toBe("Log a message.");
  });

  // ─── Schema-then-catalog resolution for any component ───

  it("shows the component description from the catalog", async () => {
    const target = await hover("ethernet:\n  type: W5500\n", "ethernet");
    expect(target?.description).toBe("Wired networking for the node.");
    expect(target?.docsUrl).toBe("https://esphome.io/components/ethernet");
  });

  it("walks the schema for a nested key", async () => {
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

  it("falls back to the catalog field description when the schema has no docs", async () => {
    const target = await hover("ethernet:\n  type: W5500\n", "type");
    expect(target?.description).toBe("**string**: The Ethernet chip type.");
    expect(target?.docsUrl).toBe("https://esphome.io/components/ethernet#type");
  });

  it("shows a bare-domain description for a platform domain", async () => {
    vi.mocked(schema.getComponentDocs).mockResolvedValue(
      "With ESPHome you can use different types of binary sensors."
    );
    const target = await hover("binary_sensor:\n  - platform: gpio\n", "binary_sensor");
    expect(target?.description).toBe(
      "With ESPHome you can use different types of binary sensors."
    );
  });
});
