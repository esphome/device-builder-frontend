import { describe, expect, it } from "vitest";
import {
  collectExistingNames,
  suggestEntityName,
} from "../../src/util/default-entity-name.js";

describe("suggestEntityName", () => {
  it("seeds the catalog title verbatim for a platform-shaped id", () => {
    expect(
      suggestEntityName(
        "sensor.a02yyuw",
        "A02YYUW Waterproof Ultrasonic Sensor",
        new Set()
      )
    ).toBe("A02YYUW Waterproof Ultrasonic Sensor");
    expect(suggestEntityName("switch.gpio", "GPIO Switch", new Set())).toBe(
      "GPIO Switch"
    );
  });

  it("returns null for undotted top-level ids", () => {
    // On the few undotted components with a top-level name field the key
    // means something else (the esphome device hostname, the BLE
    // advertised name, ...), never an entity name.
    expect(suggestEntityName("esphome", "ESPHome Core", new Set())).toBe(null);
    expect(suggestEntityName("sprinkler", "Sprinkler Controller", new Set())).toBe(null);
  });

  it("returns null for a featured wrap id", () => {
    expect(
      suggestEntityName(
        "featured.esp32-poe-iso.onboard_ethernet",
        "Ethernet (Onboard)",
        new Set()
      )
    ).toBe(null);
  });

  it("returns null for an empty or blank title and trims whitespace", () => {
    expect(suggestEntityName("switch.gpio", "", new Set())).toBe(null);
    expect(suggestEntityName("switch.gpio", "   ", new Set())).toBe(null);
    expect(suggestEntityName("switch.gpio", "  GPIO Switch ", new Set())).toBe(
      "GPIO Switch"
    );
  });

  it("suffixes with 2 on a collision and walks the counter", () => {
    expect(
      suggestEntityName("switch.gpio", "GPIO Switch", new Set(["GPIO Switch"]))
    ).toBe("GPIO Switch 2");
    expect(
      suggestEntityName(
        "switch.gpio",
        "GPIO Switch",
        new Set(["GPIO Switch", "GPIO Switch 2"])
      )
    ).toBe("GPIO Switch 3");
  });

  it("collides case-insensitively", () => {
    expect(
      suggestEntityName("switch.gpio", "GPIO Switch", new Set(["gpio switch"]))
    ).toBe("GPIO Switch 2");
  });

  it("collides on esphome's sanitize key but not across a hyphen", () => {
    // esphome compares sanitize(snake_case(name)): '?' keys like '_',
    // while '-' survives sanitization as itself.
    expect(
      suggestEntityName("switch.gpio", "GPIO Switch", new Set(["GPIO?Switch"]))
    ).toBe("GPIO Switch 2");
    expect(
      suggestEntityName("switch.gpio", "GPIO Switch", new Set(["GPIO-Switch"]))
    ).toBe("GPIO Switch");
  });
});

describe("collectExistingNames", () => {
  it("returns an empty set for empty input", () => {
    expect(collectExistingNames("", "switch")).toEqual(new Set());
  });

  it("picks up multi-word names on indented and list-item lines, peeling quotes", () => {
    const yaml = [
      "sensor:",
      '  - name: "Porch Distance"',
      "  - platform: dht",
      "",
      "    temperature:",
      "      name: Living Room Temp  # inline note",
      "",
    ].join("\n");
    expect(collectExistingNames(yaml, "sensor")).toEqual(
      new Set(["Porch Distance", "Living Room Temp"])
    );
  });

  it("scopes collection to the domain's top-level section", () => {
    // Names collide per platform in esphome, so a switch named like a
    // sensor must not force a suffix on the sensor seed.
    const yaml = [
      "esphome:",
      "  name: my-device",
      "switch:",
      "  - platform: gpio",
      '    name: "Living Room Light"',
      "sensor:",
      "  - platform: dht",
      "    name: Distance",
      "",
    ].join("\n");
    expect(collectExistingNames(yaml, "sensor")).toEqual(new Set(["Distance"]));
    expect(collectExistingNames(yaml, "switch")).toEqual(new Set(["Living Room Light"]));
    expect(collectExistingNames(yaml, "light")).toEqual(new Set());
  });

  it("ignores a column-0 name key", () => {
    expect(collectExistingNames("name: Not A Component\n", "name")).toEqual(new Set());
  });
});
