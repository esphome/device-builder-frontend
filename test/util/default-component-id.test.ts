import { describe, expect, it } from "vitest";
import {
  collectExistingIds,
  generateDefaultComponentId,
} from "../../src/util/default-component-id.js";

describe("generateDefaultComponentId", () => {
  it("returns null for top-level singletons", () => {
    // Issue #776: `web_server_1` implied a non-existent `_2`, and the
    // bare slug `web_server` would collide with the `web_server::` C++
    // namespace in ESPHome codegen. These components aren't referenced
    // by id from elsewhere, so we just don't seed one — power users
    // can type a value if they need it for `!extend` overrides.
    expect(generateDefaultComponentId("web_server", false, new Set())).toBe(null);
    expect(generateDefaultComponentId("mdns", false, new Set())).toBe(null);
    expect(generateDefaultComponentId("captive_portal", false, new Set())).toBe(null);
    expect(generateDefaultComponentId("logger", false, new Set())).toBe(null);
    expect(generateDefaultComponentId("api", false, new Set())).toBe(null);
    expect(generateDefaultComponentId("ota", false, new Set())).toBe(null);
  });

  it("ignores the existing-id set for singletons", () => {
    // Singletons return null regardless of what's already in the YAML.
    // Even an unrelated id collision shouldn't flip them back into
    // suffix-generation mode.
    const existing = new Set(["web_server", "web_server_1", "web_server_2"]);
    expect(generateDefaultComponentId("web_server", false, existing)).toBe(null);
  });

  it("suffixes top-level multi_conf components", () => {
    // `script`, `i2c`, `spi`, etc. — users add several and reference
    // them by id from automations / bus consumers, so a prefilled
    // unique id earns its keep.
    expect(generateDefaultComponentId("script", true, new Set())).toBe("script_1");
  });

  it("suffixes platform entries even when multi_conf is false", () => {
    // Platform-style ids (containing `.`) always get a suffix. Users
    // routinely add multiple entries of the same platform and reference
    // them by id (`id(my_switch).turn_on()`), so the suffix is useful.
    expect(generateDefaultComponentId("switch.gpio", false, new Set())).toBe(
      "switch_gpio_1"
    );
    expect(generateDefaultComponentId("sensor.dht", true, new Set())).toBe(
      "sensor_dht_1"
    );
  });

  it("walks the suffix counter on collision", () => {
    const existing = new Set(["switch_gpio_1", "switch_gpio_2"]);
    expect(generateDefaultComponentId("switch.gpio", true, existing)).toBe(
      "switch_gpio_3"
    );
  });

  it("walks the suffix counter for top-level multi_conf blocks too", () => {
    // Counter-walk for a top-level (no `.`) multi_conf entry is a
    // distinct code path from the platform case above — pin it.
    const existing = new Set(["script_1"]);
    expect(generateDefaultComponentId("script", true, existing)).toBe("script_2");
  });

  it("lowercases mixed-case platform ids", () => {
    expect(generateDefaultComponentId("Switch.GPIO", true, new Set())).toBe(
      "switch_gpio_1"
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
      new Set(["web_server", "temp_1", "humid_1"])
    );
  });

  it("handles single-quoted id values", () => {
    const yaml = `sensor:\n  - id: 'humid_2'\n    platform: dht\n`;
    expect(collectExistingIds(yaml)).toEqual(new Set(["humid_2"]));
  });

  it("ignores top-level (zero-indent) keys named id", () => {
    // `id:` only counts when it's a component field (indented or in a
    // list item), not when it's somehow appearing at column 0.
    const yaml = `id: something\n`;
    expect(collectExistingIds(yaml)).toEqual(new Set());
  });
});
