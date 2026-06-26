/**
 * @vitest-environment happy-dom
 *
 * A required nested entity reading (ags10's tvoc) must seed a name so an
 * untouched Add produces a valid sensor instead of "Missing required
 * field" (#1423).
 */
import { describe, expect, it } from "vitest";

import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

function ags10Component(): ComponentCatalogEntry {
  return {
    id: "sensor.ags10",
    config_entries: [
      makeConfigEntry({
        key: "tvoc",
        type: ConfigEntryType.NESTED,
        required: true,
        platform_type: "sensor",
        label: "TVOC",
        config_entries: [makeConfigEntry({ key: "name", type: ConfigEntryType.STRING })],
      }),
      makeConfigEntry({
        key: "resistance",
        type: ConfigEntryType.NESTED,
        platform_type: "sensor",
        config_entries: [makeConfigEntry({ key: "name", type: ConfigEntryType.STRING })],
      }),
    ],
  } as unknown as ComponentCatalogEntry;
}

function seededValues(
  component: ComponentCatalogEntry,
  yaml = ""
): Record<string, unknown> {
  const form = new ESPHomeAddComponentForm();
  const internals = form as unknown as {
    component: ComponentCatalogEntry;
    yaml: string;
    _localize: (key: string) => string;
    _initValues: () => void;
    _values: Record<string, unknown>;
  };
  internals.component = component;
  internals.yaml = yaml;
  internals._localize = (key) => key;
  internals._initValues();
  return internals._values;
}

describe("add-component-form seeds required nested entity names (#1423)", () => {
  it("prefills the required reading's name with its label", () => {
    const values = seededValues(ags10Component());
    expect(values.tvoc).toEqual({ name: "TVOC" });
  });

  it("leaves the optional reading unseeded", () => {
    const values = seededValues(ags10Component());
    expect(values.resistance).toBeUndefined();
  });
});

describe("add-component-form resolves featured id references to the live config", () => {
  // sensor.max17043's i2c_id carries the Apollo manifest preset `i2c_bus`;
  // it must never leak into a config whose bus has a different id.
  function batteryMonitor(presetLocked = false): ComponentCatalogEntry {
    return {
      id: "featured.apollo-esk-1.battery_monitor",
      config_entries: [
        makeConfigEntry({
          key: "i2c_id",
          type: ConfigEntryType.ID,
          references_component: "i2c",
          default_value: "i2c_bus",
          locked: presetLocked,
          from_preset: true,
        }),
      ],
    } as unknown as ComponentCatalogEntry;
  }

  const ONE_BUS = "i2c:\n  - sda: 1\n    scl: 0\n    id: i2c_1\n";
  const TWO_BUSES = `${ONE_BUS}  - sda: 3\n    scl: 2\n    id: i2c_2\n`;

  it("fills the field with the sole existing bus instead of the stale preset", () => {
    expect(seededValues(batteryMonitor(), ONE_BUS).i2c_id).toBe("i2c_1");
  });

  it("fills the sole bus even when its id equals the preset", () => {
    const yaml = "i2c:\n  - id: i2c_bus\n";
    expect(seededValues(batteryMonitor(), yaml).i2c_id).toBe("i2c_bus");
  });

  it("leaves the field unset when two buses exist so the user picks", () => {
    expect(seededValues(batteryMonitor(), TWO_BUSES).i2c_id).toBeUndefined();
  });

  it("leaves the field unset (not the literal) when no bus exists", () => {
    expect(seededValues(batteryMonitor(), "").i2c_id).toBeUndefined();
  });

  it("leaves the field unset when a packages merge could hide a bus", () => {
    const yaml = `packages:\n  base: !include base.yaml\n${ONE_BUS}`;
    expect(seededValues(batteryMonitor(), yaml).i2c_id).toBeUndefined();
  });

  it("keeps a locked reference's literal verbatim (bundled output pin)", () => {
    expect(seededValues(batteryMonitor(true), ONE_BUS).i2c_id).toBe("i2c_bus");
  });

  it("seeds a required multi_value reference with [] when it can't resolve", () => {
    const component = {
      id: "featured.x.multi_ref",
      config_entries: [
        makeConfigEntry({
          key: "buses",
          type: ConfigEntryType.ID,
          references_component: "i2c",
          required: true,
          multi_value: true,
        }),
      ],
    } as unknown as ComponentCatalogEntry;
    expect(seededValues(component, "").buses).toEqual([]);
  });
});

describe("add-component-form dep-add bus prefill (#1425)", () => {
  function busForm() {
    const form = new ESPHomeAddComponentForm();
    const internals = form as unknown as {
      component: ComponentCatalogEntry;
      _localize: (key: string) => string;
      prefillFields: Record<string, unknown> | null;
      extraRequired: string[] | null;
      _initValues: () => void;
      _values: Record<string, unknown>;
      _entries: Array<{ key: string; required?: boolean | null }>;
    };
    internals.component = {
      id: "i2c",
      config_entries: [
        makeConfigEntry({
          key: "frequency",
          type: ConfigEntryType.STRING,
          default_value: "50kHz",
        }),
        makeConfigEntry({ key: "sda", type: ConfigEntryType.PIN }),
      ],
    } as unknown as ComponentCatalogEntry;
    internals._localize = (key) => key;
    return internals;
  }

  it("merges prefillFields over the seeded defaults", () => {
    const form = busForm();
    form.prefillFields = { frequency: "15kHz" };
    form._initValues();
    expect(form._values.frequency).toBe("15kHz");
  });

  it("overlays extraRequired keys as required entries", () => {
    const form = busForm();
    form.extraRequired = ["sda"];
    expect(form._entries.find((e) => e.key === "sda")?.required).toBe(true);
    expect(form._entries.find((e) => e.key === "frequency")?.required).toBeFalsy();
  });

  // baud_rate now carries a 115200 catalog default; a detour value (an
  // LD2410 needing 256000) must win over it, and a plain add must commit
  // the default so the required field isn't left empty.
  function uartForm() {
    const form = new ESPHomeAddComponentForm();
    const internals = form as unknown as {
      component: ComponentCatalogEntry;
      _localize: (key: string) => string;
      prefillFields: Record<string, unknown> | null;
      _initValues: () => void;
      _values: Record<string, unknown>;
    };
    internals.component = {
      id: "uart",
      config_entries: [
        makeConfigEntry({
          key: "baud_rate",
          type: ConfigEntryType.INTEGER,
          required: true,
          default_value: 115200,
          allow_custom_value: true,
        }),
      ],
    } as unknown as ComponentCatalogEntry;
    internals._localize = (key) => key;
    return internals;
  }

  it("seeds the required baud_rate from its 115200 default on a plain add", () => {
    const form = uartForm();
    form._initValues();
    expect(form._values.baud_rate).toBe(115200);
  });

  it("lets a detour baud_rate clobber the 115200 default", () => {
    const form = uartForm();
    form.prefillFields = { baud_rate: 256000 };
    form._initValues();
    expect(form._values.baud_rate).toBe(256000);
  });

  it("narrows the baud dropdown to a detour's choices but keeps it typeable", () => {
    const form = uartForm() as ReturnType<typeof uartForm> & {
      optionOverrides: Record<string, (string | number)[]> | null;
      _entries: ConfigEntry[];
    };
    form.optionOverrides = { baud_rate: [2400, 9600] };
    const baud = form._entries.find((e) => e.key === "baud_rate")!;
    expect(baud.options).toEqual([
      { label: "2400", value: "2400" },
      { label: "9600", value: "9600" },
    ]);
    expect(baud.default_value).toBe(2400);
    // allow_custom_value is preserved so an unknown CN105 rate can be typed.
    expect(baud.allow_custom_value).toBe(true);
  });

  it("preserves an existing entry's labels when narrowing a labeled field", () => {
    const form = uartForm() as ReturnType<typeof uartForm> & {
      component: ComponentCatalogEntry;
      optionOverrides: Record<string, (string | number)[]> | null;
      _entries: ConfigEntry[];
    };
    form.component = {
      id: "uart",
      config_entries: [
        makeConfigEntry({
          key: "stop_bits",
          type: ConfigEntryType.STRING,
          options: [
            { label: "1 bit", value: "1" },
            { label: "2 bits", value: "2" },
          ],
        }),
      ],
    } as unknown as ComponentCatalogEntry;
    form.optionOverrides = { stop_bits: ["1", "2"] };
    const stop = form._entries.find((e) => e.key === "stop_bits")!;
    // Catalog labels survive; only the constrained subset remains.
    expect(stop.options).toEqual([
      { label: "1 bit", value: "1" },
      { label: "2 bits", value: "2" },
    ]);
    // STRING entry keeps a string default, not a coerced number.
    expect(stop.default_value).toBe("1");
  });
});
