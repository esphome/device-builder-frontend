/**
 * Unit tests for the pure value-seeding pipeline lifted out of
 * `<esphome-add-component-form>` into `add-component-form-seed.ts`.
 * These exercise the functions directly (no element mount); the
 * element-level behaviour test lives in `add-component-form-seed.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { BoardCatalogEntry, BoardPin } from "../../../src/api/types/boards.js";
import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import {
  buildInitialValues,
  findReferencePath,
  seedDefaults,
  seedReference,
} from "../../../src/components/device/add-component-form-seed.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const localize = (key: string): string => key;

function makeComponent(over: Partial<ComponentCatalogEntry> = {}): ComponentCatalogEntry {
  return {
    id: "sensor.demo",
    name: "Demo",
    description: "",
    category: "sensor" as ComponentCatalogEntry["category"],
    docs_url: "",
    image_url: "",
    dependencies: [],
    multi_conf: false,
    supported_platforms: [],
    config_entries: [],
    ...over,
  };
}

function makePin(over: Partial<BoardPin>): BoardPin {
  return {
    gpio: 0,
    label: "",
    features: [],
    available: null,
    occupied_by: null,
    notes: null,
    ...over,
  };
}

function makeBoard(pins: BoardPin[]): BoardCatalogEntry {
  return {
    id: "esp32-c3-devkitm-1",
    name: "",
    description: "",
    manufacturer: "",
    esphome: { platform: "esp32", board: "esp32-c3-devkitm-1" } as never,
    hardware: {
      flash_size: null,
      ram_size: null,
      cpu_frequency: null,
      connectivity: [],
    },
    images: [],
    tags: [],
    pins,
    docs_url: "",
    product_url: "",
    featured: false,
    is_generic: false,
    featured_components: [],
    featured_bundles: [],
  };
}

describe("findReferencePath", () => {
  it("returns the top-level key of a references_component entry", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({ key: "name", type: ConfigEntryType.STRING }),
      makeConfigEntry({ key: "i2c_id", references_component: "i2c" }),
    ];
    expect(findReferencePath(entries, "i2c", [])).toEqual(["i2c_id"]);
  });

  it("descends into NESTED entries and prefixes the parent key", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({
        key: "bus",
        type: ConfigEntryType.NESTED,
        config_entries: [
          makeConfigEntry({ key: "uart_id", references_component: "uart" }),
        ],
      }),
    ];
    expect(findReferencePath(entries, "uart", [])).toEqual(["bus", "uart_id"]);
  });

  it("returns null when the schema references no matching domain", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({ key: "i2c_id", references_component: "i2c" }),
    ];
    expect(findReferencePath(entries, "spi", [])).toBeNull();
  });
});

describe("seedDefaults", () => {
  it("seeds a required field's default but skips an optional one", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({
        key: "update_interval",
        type: ConfigEntryType.STRING,
        required: true,
        default_value: "60s",
      }),
      makeConfigEntry({
        key: "accuracy",
        type: ConfigEntryType.STRING,
        default_value: "0.1",
      }),
    ];
    expect(seedDefaults(entries, "", localize)).toEqual({ update_interval: "60s" });
  });

  it("seeds optional defaults too when seedAll is set (featured presets)", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({
        key: "accuracy",
        type: ConfigEntryType.STRING,
        default_value: "0.1",
      }),
    ];
    expect(seedDefaults(entries, "", localize, true)).toEqual({ accuracy: "0.1" });
  });

  it("wraps a multi_value default in an array", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({
        key: "tags",
        type: ConfigEntryType.STRING,
        required: true,
        multi_value: true,
        default_value: "a",
      }),
    ];
    expect(seedDefaults(entries, "", localize)).toEqual({ tags: ["a"] });
  });

  it("emits an empty array for a required multi_value with no default", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({
        key: "ids",
        type: ConfigEntryType.STRING,
        required: true,
        multi_value: true,
      }),
    ];
    expect(seedDefaults(entries, "", localize)).toEqual({ ids: [] });
  });

  it("recurses into NESTED groups regardless of parent requiredness", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({
        key: "group",
        type: ConfigEntryType.NESTED,
        config_entries: [
          makeConfigEntry({
            key: "child",
            type: ConfigEntryType.STRING,
            required: true,
            default_value: "x",
          }),
        ],
      }),
    ];
    expect(seedDefaults(entries, "", localize)).toEqual({ group: { child: "x" } });
  });

  it("omits a NESTED group that seeds nothing", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({
        key: "group",
        type: ConfigEntryType.NESTED,
        config_entries: [makeConfigEntry({ key: "opt", type: ConfigEntryType.STRING })],
      }),
    ];
    expect(seedDefaults(entries, "", localize)).toEqual({});
  });

  it("seeds a required entity sub-reading's name from resolveEntryLabel", () => {
    // A required NESTED entity with a platform_type whose sub seeds no
    // name/id of its own gets its label injected as `name`, so an
    // untouched Add still produces a valid sensor. This is the only
    // lifted branch that exercises the `localize`/`resolveEntryLabel`
    // thread-through.
    const entries: ConfigEntry[] = [
      makeConfigEntry({
        key: "tvoc",
        type: ConfigEntryType.NESTED,
        required: true,
        platform_type: "sensor",
        label: "TVOC",
        config_entries: [makeConfigEntry({ key: "opt", type: ConfigEntryType.STRING })],
      }),
    ];
    expect(seedDefaults(entries, "", localize)).toEqual({ tvoc: { name: "TVOC" } });
  });

  it("resolves the entity-name label via the localize translation_key", () => {
    // When a translation_key is registered, the resolved translation
    // wins over the catalog label — confirms the `localize` argument is
    // actually consulted, not just the static `entry.label`.
    const translate = (key: string): string =>
      key === "entity.tvoc" ? "Total VOC" : key;
    const entries: ConfigEntry[] = [
      makeConfigEntry({
        key: "tvoc",
        type: ConfigEntryType.NESTED,
        required: true,
        platform_type: "sensor",
        label: "TVOC",
        translation_key: "entity.tvoc",
        config_entries: [makeConfigEntry({ key: "opt", type: ConfigEntryType.STRING })],
      }),
    ];
    expect(seedDefaults(entries, "", translate)).toEqual({ tvoc: { name: "Total VOC" } });
  });
});

describe("buildInitialValues", () => {
  it("auto-generates a unique id for a top-level ID entry against the live YAML", () => {
    const component = makeComponent({
      id: "sensor.bme280",
      config_entries: [makeConfigEntry({ key: "id", type: ConfigEntryType.ID })],
    });
    const values = buildInitialValues({
      entries: component.config_entries,
      component,
      board: null,
      yaml: "sensor:\n  - platform: bme280\n    id: sensor_bme280_1\n",
      prefillReference: null,
      prefillFields: null,
      localize,
    });
    // _1 is taken in the YAML, so the generator skips to _2.
    expect(values.id).toBe("sensor_bme280_2");
  });

  it("does not overwrite an id already seeded by a default_value", () => {
    const component = makeComponent({
      config_entries: [
        makeConfigEntry({
          key: "id",
          type: ConfigEntryType.ID,
          required: true,
          default_value: "preset_id",
        }),
      ],
    });
    const values = buildInitialValues({
      entries: component.config_entries,
      component,
      board: null,
      yaml: "",
      prefillReference: null,
      prefillFields: null,
      localize,
    });
    expect(values.id).toBe("preset_id");
  });

  it("overlays prefillFields last, beating the catalog default", () => {
    const component = makeComponent({
      config_entries: [
        makeConfigEntry({
          key: "baud_rate",
          type: ConfigEntryType.STRING,
          required: true,
          default_value: "9600",
        }),
      ],
    });
    const values = buildInitialValues({
      entries: component.config_entries,
      component,
      board: null,
      yaml: "",
      prefillReference: null,
      prefillFields: { baud_rate: "2400" },
      localize,
    });
    expect(values.baud_rate).toBe("2400");
  });

  it("injects a prefillReference id at the matching reference path", () => {
    const component = makeComponent({
      config_entries: [makeConfigEntry({ key: "i2c_id", references_component: "i2c" })],
    });
    const values = buildInitialValues({
      entries: component.config_entries,
      component,
      board: null,
      yaml: "",
      prefillReference: { domain: "i2c", id: "bus_a" },
      prefillFields: null,
      localize,
    });
    expect(values.i2c_id).toBe("bus_a");
  });

  it("seeds pin entries from the board manifest between id-gen and prefill", () => {
    const component = makeComponent({
      id: "i2c",
      config_entries: [
        makeConfigEntry({ key: "scl", type: ConfigEntryType.PIN, default_value: "SCL" }),
        makeConfigEntry({ key: "sda", type: ConfigEntryType.PIN, default_value: "SDA" }),
      ],
    });
    const board = makeBoard([
      makePin({ gpio: 8, label: "GPIO8", features: ["i2c_sda"] }),
      makePin({ gpio: 9, label: "GPIO9", features: ["i2c_scl"] }),
    ]);
    const values = buildInitialValues({
      entries: component.config_entries,
      component,
      board,
      yaml: "",
      prefillReference: null,
      prefillFields: null,
      localize,
    });
    // Board's i2c_scl/i2c_sda feature tags win over the symbolic
    // "SCL"/"SDA" catalog defaults that don't resolve on the C3.
    expect(values.scl).toBe(9);
    expect(values.sda).toBe(8);
  });
});

describe("seedReference", () => {
  it("resolves a sole same-domain candidate to its id", () => {
    const yaml = "i2c:\n  - id: bus_a\n";
    expect(seedReference(yaml, "i2c")).toBe("bus_a");
  });

  it("defers to undefined when several candidates are ambiguous", () => {
    const yaml = "i2c:\n  - id: bus_a\n  - id: bus_b\n";
    expect(seedReference(yaml, "i2c")).toBeUndefined();
  });

  it("returns undefined when no candidate matches the domain", () => {
    expect(seedReference("i2c:\n  - id: bus_a\n", "spi")).toBeUndefined();
  });

  it("defers to undefined when a packages: merge could hide a candidate", () => {
    const yaml = "packages:\n  base: !include base.yaml\ni2c:\n  - id: bus_a\n";
    expect(seedReference(yaml, "i2c")).toBeUndefined();
  });
});
