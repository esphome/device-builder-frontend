import { beforeEach, describe, expect, it } from "vitest";
import {
  _clearYamlSectionsMemo,
  findAddedSection,
} from "../../src/util/yaml-sections.js";

/**
 * Pins `findAddedSection`'s post-add selection: bare-key match,
 * single-candidate shortcut, id disambiguation among duplicate
 * platform candidates (including a column-0 inline `- id:`, #787),
 * and the last-candidate fallback.
 */

beforeEach(() => {
  _clearYamlSectionsMemo();
});

const TWO_DHT = `esphome:
  name: dev
sensor:
  - platform: dht
    id: dht_one
    pin: GPIO1
  - platform: dht
    id: dht_two
    pin: GPIO2
`;

const TWO_DHT_COL0 = `esphome:
  name: dev
sensor:
- id: dht_one
  platform: dht
  pin: GPIO1
- id: dht_two
  platform: dht
  pin: GPIO2
`;

describe("findAddedSection", () => {
  it("matches a bare top-level component key", () => {
    const yaml = "esphome:\n  name: dev\nwifi:\n  ssid: x\n";
    expect(findAddedSection(yaml, "wifi", undefined)).toEqual({
      sectionKey: "wifi",
      fromLine: 3,
    });
  });

  it("returns the single platform candidate without needing an id", () => {
    const yaml = "sensor:\n  - platform: dht\n    pin: GPIO1\n";
    expect(findAddedSection(yaml, "sensor.dht", undefined)).toEqual({
      sectionKey: "sensor.dht",
      fromLine: 2,
    });
  });

  it("disambiguates duplicate candidates by the submitted id", () => {
    expect(findAddedSection(TWO_DHT, "sensor.dht", "dht_one")?.fromLine).toBe(4);
    expect(findAddedSection(TWO_DHT, "sensor.dht", "dht_two")?.fromLine).toBe(7);
  });

  it("disambiguates by a column-0 inline `- id:`", () => {
    expect(findAddedSection(TWO_DHT_COL0, "sensor.dht", "dht_one")?.fromLine).toBe(4);
    expect(findAddedSection(TWO_DHT_COL0, "sensor.dht", "dht_two")?.fromLine).toBe(7);
  });

  it("falls back to the last candidate when no id matches", () => {
    expect(findAddedSection(TWO_DHT, "sensor.dht", "missing")?.fromLine).toBe(7);
  });

  it("treats regex metacharacters in the id literally", () => {
    // `dht.one` must not wildcard-match the first candidate's `dhtxone`.
    const yaml = `sensor:
  - platform: dht
    id: dhtxone
  - platform: dht
    id: dht_two
`;
    expect(findAddedSection(yaml, "sensor.dht", "dht.one")?.fromLine).toBe(4);
  });

  it("returns null when nothing matches", () => {
    expect(findAddedSection("logger:\n", "sensor.dht", undefined)).toBeNull();
  });
});
