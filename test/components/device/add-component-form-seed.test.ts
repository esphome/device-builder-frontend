/**
 * @vitest-environment happy-dom
 *
 * A required nested entity reading (ags10's tvoc) must seed a name so an
 * untouched Add produces a valid sensor instead of "Missing required
 * field" (#1423).
 */
import { describe, expect, it } from "vitest";

import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
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

function seededValues(component: ComponentCatalogEntry): Record<string, unknown> {
  const form = new ESPHomeAddComponentForm();
  const internals = form as unknown as {
    component: ComponentCatalogEntry;
    _localize: (key: string) => string;
    _initValues: () => void;
    _values: Record<string, unknown>;
  };
  internals.component = component;
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
});
