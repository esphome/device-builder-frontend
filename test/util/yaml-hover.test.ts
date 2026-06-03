import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import type { ComponentCatalogEntry } from "../../src/api/types/components.js";
import type { ConfigEntry } from "../../src/api/types/config-entries.js";
import * as schema from "../../src/util/esphome-schema.js";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import type { CatalogIndex } from "../../src/util/yaml-completion.js";
import { resolveHoverTarget } from "../../src/util/yaml-hover.js";

// Stub the network-backed schema lookups; keep the rest of the module
// (bundleFor consumers, parse helpers) real.
vi.mock("../../src/util/esphome-schema.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/util/esphome-schema.js")>()),
  getConfigVarValueOptions: vi.fn(),
  getActions: vi.fn(),
  getTriggerKeys: vi.fn(),
  getRegistryEntries: vi.fn(),
  lookupRegistryRef: vi.fn(),
  getConfigVarDocsAtPath: vi.fn(),
}));

function comp(c: Partial<ComponentCatalogEntry>): ComponentCatalogEntry {
  return { config_entries: [], ...c } as unknown as ComponentCatalogEntry;
}
function field(f: Partial<ConfigEntry>): ConfigEntry {
  return f as unknown as ConfigEntry;
}

// Only `esphome` is in the catalog (with a visible `name` field) so the
// suppression path has something to match; everything else is schema-only.
const CATALOG: CatalogIndex = {
  components: [],
  byCategory: new Map(),
  byId: new Map<string, ComponentCatalogEntry>([
    [
      "esphome",
      comp({
        id: "esphome",
        name: "ESPHome Core",
        description: "Core firmware configuration.",
        docs_url: "https://esphome.io/components/esphome",
        config_entries: [
          field({
            key: "name",
            description: "The node name.",
            help_link: "https://esphome.io/components/esphome#name",
          }),
        ],
      }),
    ],
    // Platform component — keyed `<domain>.<stem>` (the reverse of the
    // schema bundle's componentKey) to pin the catalog-fallback lookup.
    [
      "binary_sensor.gpio",
      comp({
        id: "binary_sensor.gpio",
        name: "GPIO Binary Sensor",
        description: "A binary sensor on a GPIO pin.",
        docs_url: "https://esphome.io/components/binary_sensor/gpio",
        config_entries: [
          field({
            key: "pin",
            description: "The pin to monitor.",
            config_entries: [
              field({ key: "inverted", description: "Invert the level." }),
            ],
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
  vi.mocked(schema.getConfigVarValueOptions).mockResolvedValue([]);
  vi.mocked(schema.getActions).mockResolvedValue([]);
  vi.mocked(schema.getTriggerKeys).mockResolvedValue([]);
  vi.mocked(schema.getRegistryEntries).mockResolvedValue([]);
  vi.mocked(schema.lookupRegistryRef).mockResolvedValue(null);
  vi.mocked(schema.getConfigVarDocsAtPath).mockResolvedValue(null);
});

describe("resolveHoverTarget", () => {
  it("shows enum value docs when hovering a value", async () => {
    vi.mocked(schema.getConfigVarValueOptions).mockResolvedValue([
      { value: "garage_door", docs: "Garage door class." },
    ]);
    const doc = "binary_sensor:\n  - platform: template\n    device_class: garage_door\n";
    const target = await hover(doc, "garage_door");
    expect(target?.description).toBe("Garage door class.");
  });

  it("shows action docs inside an automation body", async () => {
    vi.mocked(schema.getActions).mockResolvedValue([
      { key: "logger.log", docs: "Log a message." },
    ]);
    const doc = 'esphome:\n  on_boot:\n    then:\n      - logger.log: "hi"\n';
    const target = await hover(doc, "logger.log");
    expect(target?.description).toBe("Log a message.");
  });

  it("shows trigger docs for an on_* key", async () => {
    vi.mocked(schema.getTriggerKeys).mockResolvedValue([
      { key: "on_press", docs: "Pressed." },
    ]);
    const doc =
      "binary_sensor:\n  - platform: gpio\n    on_press:\n      - logger.log: x\n";
    const target = await hover(doc, "on_press");
    expect(target?.description).toBe("Pressed.");
  });

  it("walks the schema for a deeply-nested key", async () => {
    vi.mocked(schema.getConfigVarDocsAtPath).mockResolvedValue("Scan actively.");
    const doc = "esp32_ble_tracker:\n  scan_parameters:\n    active: false\n";
    const target = await hover(doc, "active");
    expect(target?.description).toBe("Scan actively.");
    expect(vi.mocked(schema.getConfigVarDocsAtPath)).toHaveBeenCalledWith(
      API,
      "esp32_ble_tracker",
      "esp32_ble_tracker",
      ["scan_parameters", "active"]
    );
  });

  it("shows schema docs for a config-entry field (full parity)", async () => {
    vi.mocked(schema.getConfigVarDocsAtPath).mockResolvedValue("Schema name docs.");
    const target = await hover('esphome:\n  name: "x"\n', "name");
    expect(target?.description).toBe("Schema name docs.");
  });

  it("falls back to the catalog field description when the schema has none", async () => {
    // getConfigVarDocsAtPath defaults to null in beforeEach.
    const target = await hover('esphome:\n  name: "x"\n', "name");
    expect(target?.description).toBe("The node name.");
    expect(target?.docsUrl).toBe("https://esphome.io/components/esphome#name");
  });

  it("always shows a top-level component description", async () => {
    const target = await hover('esphome:\n  name: "x"\n', "esphome");
    expect(target?.description).toBe("Core firmware configuration.");
    expect(target?.docsUrl).toBe("https://esphome.io/components/esphome");
  });

  it("shows the platform component description for platform: <value>", async () => {
    const doc = "binary_sensor:\n  - platform: gpio\n    name: x\n";
    const target = await hover(doc, "gpio");
    expect(target?.description).toBe("A binary sensor on a GPIO pin.");
    expect(target?.docsUrl).toBe("https://esphome.io/components/binary_sensor/gpio");
  });

  it("falls back to the catalog for a nested platform field (correct <domain>.<stem> id)", async () => {
    // Schema walk returns null (default mock) → catalog fallback, which
    // must key the platform as binary_sensor.gpio, not gpio.binary_sensor.
    const doc = "binary_sensor:\n  - platform: gpio\n    pin:\n      inverted: false\n";
    const target = await hover(doc, "inverted");
    expect(target?.description).toBe("Invert the level.");
  });

  it("returns null on a comment line", async () => {
    expect(await hover("# just a comment\nesphome:\n", "comment")).toBeNull();
  });

  it("returns null when the schema has no docs for the key", async () => {
    expect(
      await hover("esp32_ble_tracker:\n  scan_parameters:\n    active: false\n", "active")
    ).toBeNull();
  });
});
