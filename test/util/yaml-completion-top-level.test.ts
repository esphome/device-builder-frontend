import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import {
  ComponentCategory,
  type ComponentCatalogEntry,
} from "../../src/api/types.js";
import { _resetSchemaCacheForTests } from "../../src/util/esphome-schema.js";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import {
  buildTopLevelCompletions,
  createYamlCompletionSource,
  matchKeyPosition,
  matchValuePosition,
  platformValueCompletion,
} from "../../src/util/yaml-completion.js";
import { makeComponentEntry } from "./_make-component-entry.js";

type CatalogIndex = Parameters<typeof buildTopLevelCompletions>[0];

const entry = (id: string, category: ComponentCategory) =>
  makeComponentEntry(id, { category });

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

describe("buildTopLevelCompletions", () => {
  it("includes platform-domain umbrellas extracted from categories", () => {
    // The catalog only carries dotted ids for platform implementations
    // — typing ``b`` at column 0 should still surface
    // ``binary_sensor`` (the YAML key the user actually types), not
    // ``binary_sensor.gpio`` / ``binary_sensor.apds9960`` (platform
    // values that belong INSIDE the block).
    const c = catalog([
      entry("binary_sensor.gpio", ComponentCategory.BINARY_SENSOR),
      entry("binary_sensor.apds9960", ComponentCategory.BINARY_SENSOR),
      entry("sensor.dht", ComponentCategory.SENSOR),
    ]);
    const labels = buildTopLevelCompletions(c).map((o) => o.label);
    expect(labels).toContain("binary_sensor");
    expect(labels).toContain("sensor");
    expect(labels).not.toContain("binary_sensor.gpio");
    expect(labels).not.toContain("binary_sensor.apds9960");
    expect(labels).not.toContain("sensor.dht");
  });

  it("includes standalone components with non-dotted ids", () => {
    const c = catalog([
      entry("wifi", ComponentCategory.CORE),
      entry("logger", ComponentCategory.CORE),
      entry("esphome", ComponentCategory.CORE),
    ]);
    const labels = buildTopLevelCompletions(c).map((o) => o.label);
    expect(labels.sort()).toEqual(["esphome", "logger", "wifi"]);
  });

  it("offers binary_sensor when typing 'b' / 'binary_'", () => {
    // User-reported regression: typing ``binary_sensor`` at top level
    // returned no completion. Pin the bare-domain entry so a future
    // refactor can't filter it out again.
    const c = catalog([
      entry("binary_sensor.gpio", ComponentCategory.BINARY_SENSOR),
      entry("bedjet", ComponentCategory.MISC),
    ]);
    const labels = buildTopLevelCompletions(c).map((o) => o.label);
    expect(labels).toContain("binary_sensor");
    // ``bedjet`` (non-dotted, MISC category) should appear as a
    // standalone component too.
    expect(labels).toContain("bedjet");
  });

  it("dedupes when both a domain umbrella and a component share a name", () => {
    // Defensive: a platform implementation in the BINARY_SENSOR
    // category and a hypothetical bare ``binary_sensor`` component
    // shouldn't double-count.
    const c = catalog([
      entry("binary_sensor.gpio", ComponentCategory.BINARY_SENSOR),
      entry("binary_sensor", ComponentCategory.BINARY_SENSOR),
    ]);
    const labels = buildTopLevelCompletions(c).map((o) => o.label);
    expect(labels.filter((l) => l === "binary_sensor").length).toBe(1);
  });

  it("emits a sensible apply snippet (key:\\n  ) for both shapes", () => {
    const c = catalog([
      entry("binary_sensor.gpio", ComponentCategory.BINARY_SENSOR),
      entry("wifi", ComponentCategory.CORE),
    ]);
    const out = buildTopLevelCompletions(c);
    const bs = out.find((o) => o.label === "binary_sensor")!;
    const wifi = out.find((o) => o.label === "wifi")!;
    expect(bs.apply).toBe("binary_sensor:\n  ");
    expect(wifi.apply).toBe("wifi:\n  ");
  });

  it("returns [] for an empty catalog", () => {
    expect(buildTopLevelCompletions(catalog([]))).toEqual([]);
  });

  it("derives umbrellas from id prefixes too (defensive against missing category)", () => {
    // ``ota.esphome`` and ``update.http_request`` carry their
    // own categories (OTA / UPDATE) but the regex-derived
    // ``id.split(".")[0]`` belt-and-braces also surfaces the
    // umbrella name in case the category enum drifts.
    const c = catalog([
      entry("ota.esphome", ComponentCategory.OTA),
      entry("update.http_request", ComponentCategory.UPDATE),
    ]);
    const labels = buildTopLevelCompletions(c).map((o) => o.label);
    expect(labels).toContain("ota");
    expect(labels).toContain("update");
  });
});

describe("platform-list fallback", () => {
  // Hardcoded ``platform:`` suggestion at list-item position
  // under a known platform domain. The catalog never carries a
  // bare ``platform`` key on these domains' config_entries —
  // only the dotted platform implementations
  // (``ota.esphome`` / ``binary_sensor.gpio`` / …) — so the
  // completion source synthesises the suggestion from the
  // ``catalog.byCategory.has(parent.key)`` signal.
  it("recognises domain umbrellas via byCategory", () => {
    const c = catalog([
      entry("ota.esphome", ComponentCategory.OTA),
      entry("binary_sensor.gpio", ComponentCategory.BINARY_SENSOR),
      entry("sensor.dht", ComponentCategory.SENSOR),
    ]);
    expect(c.byCategory.has("ota")).toBe(true);
    expect(c.byCategory.has("binary_sensor")).toBe(true);
    expect(c.byCategory.has("sensor")).toBe(true);
    // ``catalog.byCategory.has(parent.key)`` is the signal the
    // completion source uses to decide whether to surface
    // ``platform:`` at a list-item position.
  });
});

describe("resolveAvailableEntries (platform-merged)", () => {
  // Re-import here so the test is self-contained when this file
  // is read in isolation.
  it("looks up the dotted id when parentKey is the literal 'platform' keyword", async () => {
    // User scenario: cursor is at ``    nam`` under
    // ``binary_sensor:\n  - platform: template\n``. The indent
    // walker pulls ``platform`` as ``parent.key``; the AST
    // supplies the real top-level block ``binary_sensor``. The
    // catalog keys this implementation as ``binary_sensor.template``.
    const { resolveAvailableEntries } = await import(
      "../../src/util/yaml-completion.js"
    );
    const platformEntry: ComponentCatalogEntry = {
      ...entry("binary_sensor.template", ComponentCategory.BINARY_SENSOR),
      config_entries: [
        {
          key: "name",
          type: "string" as never,
          label: "Name",
          description: null,
          required: true,
          advanced: false,
          hidden: false,
          options: null,
          default_value: null,
          range: null,
          unit_of_measurement: null,
          references_component: null,
          id_type: null,
          use_id_type: null,
          inline: false,
          sub_entries: null,
        } as never,
      ],
    };
    const c = catalog([platformEntry]);
    const fakeApi = {
      getComponent: async () => null,
    } as never;
    const out = await (resolveAvailableEntries as unknown as Function)(
      fakeApi,
      c,
      "platform", // parentKey from indent walker
      "template", // platformValue from sibling
      "binary_sensor", // topLevelKey from AST
    );
    expect(out.map((e: { key: string }) => e.key)).toContain("name");
  });
});

describe("matchKeyPosition", () => {
  it("matches plain key partials", () => {
    expect(matchKeyPosition("  on")).toEqual({
      leading: "  ",
      partial: "on",
      isListItem: false,
    });
  });

  it("matches list-item key partials with dotted action keys", () => {
    expect(matchKeyPosition("    - logger.lo")).toEqual({
      leading: "    ",
      partial: "logger.lo",
      isListItem: true,
    });
  });

  it("returns null for non-key positions (mid-value)", () => {
    expect(matchKeyPosition("  name: foo bar")).toBeNull();
  });
});

describe("platformValueCompletion", () => {
  it("strips the domain prefix so the apply text is the bare stem", () => {
    // YAML ``platform:`` value is the stem (``gpio``), not the
    // dotted catalog id (``binary_sensor.gpio``). Mirrors the
    // legacy ``getPlatformNames`` which yielded each entry as
    // the bare component name.
    const c = platformValueCompletion(
      entry("binary_sensor.gpio", ComponentCategory.BINARY_SENSOR),
    );
    expect(c.label).toBe("gpio");
    expect(c.detail).toBe(ComponentCategory.BINARY_SENSOR);
  });

  it("leaves non-dotted ids alone (for safety)", () => {
    const c = platformValueCompletion(
      entry("plain", ComponentCategory.MISC),
    );
    expect(c.label).toBe("plain");
  });
});

describe("matchValuePosition", () => {
  it("matches plain mapping values", () => {
    expect(matchValuePosition("  ssid: my")).toEqual({
      leading: "  ",
      key: "ssid",
      partial: "my",
    });
  });

  it("matches list-item header values (the user-reported case)", () => {
    // ``- platform: t`` under a domain block. The dash form was
    // rejected by the older value-position regex; the value
    // completion never fired for it. Pin the new shape so a
    // future regex tweak doesn't drop it again.
    expect(matchValuePosition("  - platform: t")).toEqual({
      leading: "  ",
      key: "platform",
      partial: "t",
    });
  });

  it("returns null for key positions (no colon yet)", () => {
    expect(matchValuePosition("  - platform")).toBeNull();
  });

  it("captures an empty partial for ``key: `` exactly", () => {
    expect(matchValuePosition("  ssid: ")).toEqual({
      leading: "  ",
      key: "ssid",
      partial: "",
    });
  });
});

describe("createYamlCompletionSource (auto-fire at value position)", () => {
  // User-reported: cursor sitting at ``device_class:`` (value
  // typed but no partial yet) didn't open the enum popup until
  // ctrl-space. Pin the new behaviour: the source returns a
  // non-null result for the empty-partial case at value position
  // even when ``explicit === false``, so CodeMirror's
  // implicit-completion path opens the popup automatically.
  beforeEach(() => {
    _resetSchemaCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "HEAD") return new Response(null, { status: 200 });
        if (url.includes("uptime.json")) {
          return new Response(
            JSON.stringify({
              "uptime.sensor": {
                schemas: {
                  CONFIG_SCHEMA: {
                    type: "typed",
                    typed_key: "type",
                    types: {
                      seconds: {
                        config_vars: {},
                        extends: ["sensor._SENSOR_SCHEMA"],
                      },
                    },
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes("sensor.json")) {
          return new Response(
            JSON.stringify({
              sensor: {
                schemas: {
                  _SENSOR_SCHEMA: {
                    type: "schema",
                    schema: {
                      config_vars: {
                        device_class: {
                          type: "enum",
                          values: {
                            duration: { docs: "Time elapsed" },
                            temperature: {},
                            humidity: {},
                          },
                        },
                      },
                    },
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the enum popup at ``device_class: `` without ctrl-space", async () => {
    const yaml = [
      "sensor:",
      "  - platform: uptime",
      "    name: zwave",
      "    device_class: ",
    ].join("\n");
    const state = EditorState.create({
      doc: yaml,
      extensions: [esphomeYaml()],
    });
    const fakeApi = {
      getComponents: async () => ({
        components: [
          {
            id: "sensor.uptime",
            name: "sensor.uptime",
            description: "",
            category: ComponentCategory.SENSOR,
            docs_url: "",
            image_url: "",
            dependencies: [],
            multi_conf: false,
            supported_platforms: [],
            config_entries: [],
          },
        ],
      }),
      getVersion: async () => ({
        server_version: "0.0.0",
        esphome_version: "2026.5.0",
      }),
      getComponent: async () => null,
    } as never;
    const source = createYamlCompletionSource(fakeApi);
    // ``explicit: false`` is the implicit-typing path that
    // previously bailed for the empty-partial case.
    const ctx = new CompletionContext(state, yaml.length, false);
    const result = await source(ctx);
    expect(result).not.toBeNull();
    const labels = (result?.options ?? []).map((o) => o.label).sort();
    expect(labels).toContain("duration");
    expect(labels).toContain("temperature");
    expect(labels).toContain("humidity");
  });
});
