import { describe, expect, it } from "vitest";

import { type ComponentCatalogEntry } from "../../../../src/api/types/components.js";
import { ambiguousNameIds } from "../../../../src/components/device/component-catalog/filters.js";

function entry(id: string, name: string, category: string): ComponentCatalogEntry {
  return {
    id,
    name,
    description: "",
    category,
    docs_url: "",
    image_url: "",
    dependencies: [],
    multi_conf: true,
    supported_platforms: [],
    config_entries: [],
  };
}

describe("ambiguousNameIds", () => {
  it("flags same-name entries within one category", () => {
    const ids = ambiguousNameIds([
      entry("stepper.a4988", "Stepper Component", "stepper"),
      entry("stepper.uln2003", "Stepper Component", "stepper"),
    ]);
    expect(ids).toEqual(new Set(["stepper.a4988", "stepper.uln2003"]));
  });

  it("ignores same-name entries from different categories", () => {
    // sensor.debug / text_sensor.debug share the name but the
    // category chip already separates them.
    const ids = ambiguousNameIds([
      entry("sensor.debug", "Debug Component", "sensor"),
      entry("text_sensor.debug", "Debug Component", "text_sensor"),
    ]);
    expect(ids).toEqual(new Set());
  });

  it("returns an empty set when every name is unique", () => {
    const ids = ambiguousNameIds([
      entry("sensor.dht", "DHT", "sensor"),
      entry("sensor.bme280", "BME280", "sensor"),
    ]);
    expect(ids).toEqual(new Set());
  });
});
