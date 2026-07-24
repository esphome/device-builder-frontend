/**
 * @vitest-environment happy-dom
 *
 * The section header keeps the featured entry's presentation (module
 * photo, name, description) for an instance a featured component
 * materialized, falling back per-field to the catalog.
 */
import { describe, expect, it } from "vitest";

import { renderSectionHeader } from "../../../src/components/device/device-section-config/render-header.js";
import type { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import type { SectionConfigResponse } from "../../../src/components/device/device-section-config/loading.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
} from "../../_lit-template-walker.js";
import { makeTestBoard } from "./_renderer-fixtures.js";

const BOARD = makeTestBoard({
  overrides: {
    id: "apollo-esk-1",
    featured_components: [
      {
        id: "rgb_leds",
        component_id: "light.esp32_rmt_led_strip",
        name: "RGB LEDs (module)",
        description: "The 10 RGB LEDs by themselves.",
        image_url: "https://cdn.example/led_module.png",
        fields: { id: { value: "rgb_leds" } },
      },
      {
        id: "onboard_rgb_led",
        component_id: "light.esp32_rmt_led_strip",
        name: "Onboard RGB LED",
        description: "The onboard RGB LED.",
        fields: { id: { value: "onboard_rgb_led" } },
      },
      {
        id: "relay_1",
        component_id: "light.esp32_rmt_led_strip",
        name: null,
        description: null,
        fields: {
          id: { value: "relay_1" },
          name: { value: "Relay 1" },
        },
      },
    ],
  } as never,
});

const CONFIG = {
  section_key: "light.esp32_rmt_led_strip",
  title: "ESP32 RMT LED Strip",
  description: "Generic catalog description.",
  docs_url: "",
  image_url: "https://cdn.example/generic.png",
} as SectionConfigResponse;

function makeHost(values: Record<string, unknown>): ESPHomeDeviceSectionConfig {
  return {
    _isUnknown: false,
    _isPlatformDomain: false,
    _localize: (key: string) => key,
    board: BOARD,
    sectionKey: "light.esp32_rmt_led_strip",
    _values: values,
  } as unknown as ESPHomeDeviceSectionConfig;
}

const serialize = (tpl: unknown): string =>
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v)) ?? "";

const imgSrc = (tpl: unknown): unknown =>
  extractAttributeBindings(findTemplatesByAnchor(tpl, "<img")[0]).src;

describe("section header featured presentation", () => {
  it("uses the matching featured entry's name, description, and image", () => {
    const tpl = renderSectionHeader(makeHost({ id: "rgb_leds" }), CONFIG, []);
    const out = serialize(tpl);
    expect(out).toContain("RGB LEDs (module)");
    expect(out).toContain("The 10 RGB LEDs by themselves.");
    expect(imgSrc(tpl)).toBe("https://cdn.example/led_module.png");
  });

  it("falls back to the catalog image when the featured entry has none", () => {
    const tpl = renderSectionHeader(makeHost({ id: "onboard_rgb_led" }), CONFIG, []);
    expect(serialize(tpl)).toContain("Onboard RGB LED");
    expect(imgSrc(tpl)).toBe("https://cdn.example/generic.png");
  });

  it("names an unnamed entry from its name preset, like the add card", () => {
    // Mirrors the backend's _featured_display_name chain so the header
    // and the recommended card never disagree on the entry's name.
    const tpl = renderSectionHeader(makeHost({ id: "relay_1" }), CONFIG, []);
    expect(serialize(tpl)).toContain("Relay 1");
  });

  it("keeps the catalog presentation for a hand-authored instance", () => {
    const tpl = renderSectionHeader(makeHost({ id: "my_own_strip" }), CONFIG, []);
    const out = serialize(tpl);
    expect(out).toContain("ESP32 RMT LED Strip");
    expect(out).toContain("Generic catalog description.");
    expect(imgSrc(tpl)).toBe("https://cdn.example/generic.png");
  });
});
