import { describe, expect, it } from "vitest";
import {
  addTakenIdsFromValues,
  collectExistingIds,
  collectTakenIds,
  generateDefaultComponentId,
  generateNestedItemId,
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

  it("returns null for a single-instance featured wrap (dotted id, multi_conf false)", () => {
    // `featured.<board>.<local>` has dots but wraps one underlying
    // component; a single-instance wrap (ethernet, wifi) must not get an id.
    expect(
      generateDefaultComponentId(
        "featured.esp32-poe-iso.onboard_ethernet",
        false,
        new Set()
      )
    ).toBe(null);
  });

  it("suffixes a multi-instance featured wrap and normalises board dashes", () => {
    // Board dashes (`esp32-poe-iso`) must become underscores so the id is
    // a valid ESPHome identifier ([a-zA-Z_][a-zA-Z0-9_]*).
    expect(
      generateDefaultComponentId(
        "featured.athom-smart-plug-v3.power_monitor",
        true,
        new Set()
      )
    ).toBe("featured_athom_smart_plug_v3_power_monitor_1");
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

describe("generateNestedItemId", () => {
  it("suffixes the list key", () => {
    expect(generateNestedItemId("microphone", new Set())).toBe("microphone_1");
    expect(generateNestedItemId("devices", new Set())).toBe("devices_1");
  });

  it("increments past taken ids", () => {
    const existing = new Set(["microphone_1", "microphone_2", "my_mic"]);
    expect(generateNestedItemId("microphone", existing)).toBe("microphone_3");
  });

  it("slugs a key that isn't already id-shaped", () => {
    expect(generateNestedItemId("On-Off", new Set())).toBe("on_off_1");
  });

  it("prefixes an underscore when the key starts with a digit", () => {
    expect(generateNestedItemId("1wire", new Set())).toBe("_1wire_1");
  });
});

describe("collectTakenIds", () => {
  it("collects plain and prefixed id keys", () => {
    const yaml = `tca9548a:
  - id: mux
    channels:
      - bus_id: channels_1
sensor:
  - platform: dht
    uart_id: uart_1
`;
    expect(collectTakenIds(yaml)).toEqual(new Set(["mux", "channels_1", "uart_1"]));
  });

  it("ignores keys that merely end in the letters id", () => {
    const yaml = `foo:\n  valid: yes\n  uuid: abc\n`;
    expect(collectTakenIds(yaml)).toEqual(new Set());
  });

  it("ignores top-level keys", () => {
    expect(collectTakenIds("id: something\n")).toEqual(new Set());
  });
});

describe("addTakenIdsFromValues", () => {
  it("walks nested lists and mappings for id-naming keys", () => {
    const taken = new Set<string>();
    addTakenIdsFromValues(
      {
        services: [
          { characteristics: [{ id: "characteristics_1" }] },
          { characteristics: [{ id: "characteristics_2" }] },
        ],
        channels: [{ bus_id: "channels_9" }],
        name: "not an id",
        empty: "",
      },
      taken
    );
    expect(taken).toEqual(
      new Set(["characteristics_1", "characteristics_2", "channels_9"])
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
