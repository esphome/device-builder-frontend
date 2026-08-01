import { describe, expect, it } from "vitest";
import {
  collectExistingNames,
  suggestEntityName,
} from "../../src/util/default-entity-name.js";

const switchYaml = (...names: string[]): string =>
  ["switch:", ...names.map((n) => `  - name: ${n}`), ""].join("\n");

describe("suggestEntityName", () => {
  it("seeds the catalog title verbatim for a platform-shaped id", () => {
    expect(
      suggestEntityName("sensor.a02yyuw", "A02YYUW Waterproof Ultrasonic Sensor", "")
    ).toBe("A02YYUW Waterproof Ultrasonic Sensor");
    expect(suggestEntityName("switch.gpio", "GPIO Switch", "")).toBe("GPIO Switch");
  });

  it("seeds undotted components whose name is a display label", () => {
    expect(suggestEntityName("ble_client", "BLE Client", "")).toBe("BLE Client");
    expect(suggestEntityName("esp32_camera", "ESP32 Camera", "")).toBe("ESP32 Camera");
    expect(suggestEntityName("sprinkler", "Sprinkler Controller", "")).toBe(
      "Sprinkler Controller"
    );
    expect(suggestEntityName("serial_proxy", "Serial Proxy", "")).toBe("Serial Proxy");
  });

  it("returns null for an undotted name the firmware derives elsewhere", () => {
    // The node hostname and the advertised BLE name (which defaults to it)
    // are identities, not labels.
    expect(suggestEntityName("esphome", "ESPHome Core", "")).toBe(null);
    expect(suggestEntityName("esp32_ble", "ESP32 BLE", "")).toBe(null);
  });

  it("scopes an undotted collision to its own section", () => {
    const yaml = ["ble_client:", "  - name: BLE Client", ""].join("\n");
    expect(suggestEntityName("ble_client", "BLE Client", yaml)).toBe("BLE Client 2");
  });

  it("returns null for a featured wrap id", () => {
    expect(
      suggestEntityName(
        "featured.esp32-poe-iso.onboard_ethernet",
        "Ethernet (Onboard)",
        ""
      )
    ).toBe(null);
  });

  it("returns null for an empty or blank title and trims whitespace", () => {
    expect(suggestEntityName("switch.gpio", "", "")).toBe(null);
    expect(suggestEntityName("switch.gpio", "   ", "")).toBe(null);
    expect(suggestEntityName("switch.gpio", "  GPIO Switch ", "")).toBe("GPIO Switch");
  });

  it("suffixes with 2 on a collision and walks the counter", () => {
    expect(
      suggestEntityName("switch.gpio", "GPIO Switch", switchYaml("GPIO Switch"))
    ).toBe("GPIO Switch 2");
    expect(
      suggestEntityName(
        "switch.gpio",
        "GPIO Switch",
        switchYaml("GPIO Switch", "GPIO Switch 2")
      )
    ).toBe("GPIO Switch 3");
  });

  it("collides case-insensitively", () => {
    expect(
      suggestEntityName("switch.gpio", "GPIO Switch", switchYaml("gpio switch"))
    ).toBe("GPIO Switch 2");
  });

  it("collides on esphome's sanitize key but not across a hyphen", () => {
    // esphome compares sanitize(snake_case(name)): '?' keys like '_',
    // while '-' survives sanitization as itself.
    expect(
      suggestEntityName("switch.gpio", "GPIO Switch", switchYaml("GPIO?Switch"))
    ).toBe("GPIO Switch 2");
    expect(
      suggestEntityName("switch.gpio", "GPIO Switch", switchYaml("GPIO-Switch"))
    ).toBe("GPIO Switch");
  });

  it("scopes the collision pool to the component's own platform section", () => {
    expect(
      suggestEntityName("sensor.template", "GPIO Switch", switchYaml("GPIO Switch"))
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
      "# ---- more sensors ----",
      "  - platform: adc",
      "    name: Voltage",
      "",
    ].join("\n");
    expect(collectExistingNames(yaml, "sensor")).toEqual(
      new Set(["Distance", "Voltage"])
    );
    expect(collectExistingNames(yaml, "switch")).toEqual(new Set(["Living Room Light"]));
    expect(collectExistingNames(yaml, "light")).toEqual(new Set());
  });

  it("ignores a column-0 name key", () => {
    expect(collectExistingNames("name: Not A Component\n", "name")).toEqual(new Set());
  });
});
