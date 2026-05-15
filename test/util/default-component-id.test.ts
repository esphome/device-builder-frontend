import { describe, expect, it } from "vitest";
import {
  collectExistingIds,
  generateDefaultComponentId,
} from "../../src/util/default-component-id.js";

describe("generateDefaultComponentId", () => {
  it("emits the bare slug for top-level singletons", () => {
    // `web_server` is the canonical case from issue #776: a
    // `multi_conf: false` top-level block where `_1` is misleading.
    expect(generateDefaultComponentId("web_server", false, new Set())).toBe(
      "web_server",
    );
    expect(generateDefaultComponentId("mdns", false, new Set())).toBe("mdns");
    expect(generateDefaultComponentId("captive_portal", false, new Set())).toBe(
      "captive_portal",
    );
  });

  it("suffixes top-level multi_conf components", () => {
    expect(generateDefaultComponentId("script", true, new Set())).toBe(
      "script_1",
    );
  });

  it("suffixes platform entries even when multi_conf is false", () => {
    // Platform-style ids (containing `.`) always get a suffix because
    // users routinely add multiple entries of the same platform; the
    // suffix is what disambiguates them in the generated YAML.
    expect(generateDefaultComponentId("switch.gpio", false, new Set())).toBe(
      "switch_gpio_1",
    );
    expect(generateDefaultComponentId("sensor.dht", true, new Set())).toBe(
      "sensor_dht_1",
    );
  });

  it("walks the suffix counter on collision", () => {
    const existing = new Set(["switch_gpio_1", "switch_gpio_2"]);
    expect(generateDefaultComponentId("switch.gpio", true, existing)).toBe(
      "switch_gpio_3",
    );
  });

  it("falls back to a numeric suffix when the bare singleton slug is taken", () => {
    // A user could have manually assigned `id: web_server` elsewhere
    // (e.g. renamed a sensor). The generator must still emit a
    // unique id rather than producing a duplicate.
    const existing = new Set(["web_server"]);
    expect(generateDefaultComponentId("web_server", false, existing)).toBe(
      "web_server_1",
    );
  });

  it("lowercases mixed-case component ids", () => {
    expect(generateDefaultComponentId("Web_Server", false, new Set())).toBe(
      "web_server",
    );
  });
});

describe("collectExistingIds", () => {
  it("returns an empty set for empty input", () => {
    expect(collectExistingIds("")).toEqual(new Set());
  });

  it("picks up ids on indented and list-item lines", () => {
    const yaml = `web_server:
  id: web_server
sensor:
  - id: temp_1
    platform: dht
  - id: "humid_1"
    platform: dht
`;
    expect(collectExistingIds(yaml)).toEqual(
      new Set(["web_server", "temp_1", "humid_1"]),
    );
  });

  it("ignores top-level (zero-indent) keys named id", () => {
    // `id:` only counts when it's a component field (indented or in a
    // list item), not when it's somehow appearing at column 0.
    const yaml = `id: something\n`;
    expect(collectExistingIds(yaml)).toEqual(new Set());
  });
});
