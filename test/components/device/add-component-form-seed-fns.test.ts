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

  it("skips a reference seeding already filled but targets an unfilled one", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({ key: "blue", references_component: "output" }),
      makeConfigEntry({ key: "warm", references_component: "output" }),
    ];
    expect(findReferencePath(entries, "output", [], { blue: "output_blue" })).toEqual([
      "warm",
    ]);
  });

  it("returns null when seeding already filled the only matching reference", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({ key: "blue", references_component: "output" }),
    ];
    expect(findReferencePath(entries, "output", [], { blue: "output_blue" })).toBeNull();
  });

  it("targets a reference seeding left empty so a chained prefill isn't stranded", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({ key: "blue", references_component: "output" }),
    ];
    expect(findReferencePath(entries, "output", [], {})).toEqual(["blue"]);
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

  it("seeds an optional from_preset field when seedPresets is set (featured presets)", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({
        key: "accuracy",
        type: ConfigEntryType.STRING,
        default_value: "0.1",
        from_preset: true,
      }),
    ];
    expect(seedDefaults(entries, "", localize, true)).toEqual({ accuracy: "0.1" });
  });

  it("leaves a plain optional default unseeded even with seedPresets set", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({
        key: "clock_speed",
        type: ConfigEntryType.STRING,
        default_value: "26.67MHz",
      }),
    ];
    expect(seedDefaults(entries, "", localize, true)).toEqual({});
  });

  const TWO_OUTPUTS =
    "output:\n  - platform: ledc\n    id: output_red\n" +
    "  - platform: ledc\n    id: output_blue\n";

  const presetRef = (over: Partial<ConfigEntry> = {}): ConfigEntry =>
    makeConfigEntry({
      key: "blue",
      type: ConfigEntryType.ID,
      required: true,
      references_component: "output",
      from_preset: true,
      default_value: "output_blue",
      ...over,
    });

  it("fills a from_preset reference from its default when that id is among several candidates", () => {
    expect(seedDefaults([presetRef()], TWO_OUTPUTS, localize, true)).toEqual({
      blue: "output_blue",
    });
  });

  it("falls back to the sole candidate when the preset id is absent", () => {
    const yaml = "output:\n  - platform: ledc\n    id: output_only\n";
    expect(
      seedDefaults([presetRef({ default_value: "output_missing" })], yaml, localize, true)
    ).toEqual({ blue: "output_only" });
  });

  it("leaves the reference unset when the preset id is stale and several candidates exist", () => {
    expect(
      seedDefaults(
        [presetRef({ default_value: "output_missing" })],
        TWO_OUTPUTS,
        localize,
        true
      )
    ).toEqual({});
  });

  it("ignores the from_preset default when seedPresets is false", () => {
    // Without seedPresets the preset path is off; >1 candidate has no sole match.
    expect(seedDefaults([presetRef()], TWO_OUTPUTS, localize, false)).toEqual({});
  });

  it("wraps a multi_value preset reference in an array", () => {
    expect(
      seedDefaults([presetRef({ multi_value: true })], TWO_OUTPUTS, localize, true)
    ).toEqual({ blue: ["output_blue"] });
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
      restoredValues: null,
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
      restoredValues: null,
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
      restoredValues: null,
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
      restoredValues: null,
      localize,
    });
    expect(values.i2c_id).toBe("bus_a");
  });

  it("restores pre-detour values but lets prefillReference win for the ref field", () => {
    const component = makeComponent({
      config_entries: [
        makeConfigEntry({ key: "cs_pin", type: ConfigEntryType.PIN }),
        makeConfigEntry({ key: "i2c_id", references_component: "i2c" }),
      ],
    });
    const values = buildInitialValues({
      entries: component.config_entries,
      component,
      board: null,
      yaml: "",
      prefillReference: { domain: "i2c", id: "bus_a" },
      prefillFields: null,
      restoredValues: { cs_pin: "GPIO5", i2c_id: "stale" },
      localize,
    });
    // The pin the user picked before the "+ Add i2c" detour is preserved.
    expect(values.cs_pin).toBe("GPIO5");
    // The just-added bus id still wins over the restored (empty) reference.
    expect(values.i2c_id).toBe("bus_a");
  });

  it("does not let a chained prefillReference overwrite a preset-pinned ref", () => {
    // The bundle path hands the last-added sibling (output_warm) as a single
    // prefill; it must land on the unpinned ref, not clobber blue's preset.
    const component = makeComponent({
      id: "featured.bd.id_name",
      config_entries: [
        makeConfigEntry({
          key: "blue",
          type: ConfigEntryType.ID,
          required: true,
          references_component: "output",
          from_preset: true,
          default_value: "output_blue",
        }),
        makeConfigEntry({ key: "warm", references_component: "output" }),
      ],
    });
    const yaml =
      "output:\n  - platform: ledc\n    id: output_blue\n" +
      "  - platform: ledc\n    id: output_warm\n";
    const values = buildInitialValues({
      entries: component.config_entries,
      component,
      board: null,
      yaml,
      prefillReference: { domain: "output", id: "output_warm" },
      prefillFields: null,
      restoredValues: null,
      localize,
    });
    expect(values.blue).toBe("output_blue");
    expect(values.warm).toBe("output_warm");
  });

  it("applies a chained prefillReference to a from_preset ref that seeding left empty", () => {
    // Stale preset id among several same-domain candidates: seedDefaults can't
    // fill blue, so the just-added dep must still land there, not be stranded.
    const component = makeComponent({
      id: "featured.bd.thing",
      config_entries: [
        makeConfigEntry({
          key: "blue",
          type: ConfigEntryType.ID,
          required: true,
          references_component: "output",
          from_preset: true,
          default_value: "output_stale",
        }),
      ],
    });
    const yaml =
      "output:\n  - platform: ledc\n    id: output_a\n" +
      "  - platform: ledc\n    id: output_b\n";
    const values = buildInitialValues({
      entries: component.config_entries,
      component,
      board: null,
      yaml,
      prefillReference: { domain: "output", id: "output_a" },
      prefillFields: null,
      restoredValues: null,
      localize,
    });
    expect(values.blue).toBe("output_a");
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
      restoredValues: null,
      localize,
    });
    // Board's i2c_scl/i2c_sda feature tags win over the symbolic
    // "SCL"/"SDA" catalog defaults that don't resolve on the C3.
    expect(values.scl).toBe(9);
    expect(values.sda).toBe(8);
  });
});
