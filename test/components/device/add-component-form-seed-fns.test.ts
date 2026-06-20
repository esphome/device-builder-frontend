/**
 * Unit tests for the pure value-seeding pipeline lifted out of
 * `<esphome-add-component-form>` into `add-component-form-seed.ts`.
 * These exercise the functions directly (no element mount); the
 * element-level behaviour test lives in `add-component-form-seed.test.ts`.
 */
import { describe, expect, it } from "vitest";

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
});
