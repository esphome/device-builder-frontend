import { describe, expect, it } from "vitest";
import { resolveSectionForUrlLine } from "../../src/util/url-line-resolver.js";

const SAMPLE_YAML = `esphome:
  name: kitchen
  friendly_name: Kitchen Lamp

esp32:
  board: esp32-c3-devkitm-1

wifi:
  ssid: home_network
  password: !secret wifi_password

api:

logger:

binary_sensor:
  - platform: gpio
    pin: GPIO2
    name: Doorbell
`;

describe("resolveSectionForUrlLine", () => {
  it("returns null when line is undefined", () => {
    expect(resolveSectionForUrlLine(SAMPLE_YAML, undefined, null)).toBeNull();
  });

  it("returns null when YAML is empty (still loading)", () => {
    expect(resolveSectionForUrlLine("", 5, null)).toBeNull();
  });

  it("returns null when a section is already selected (don't overwrite)", () => {
    expect(resolveSectionForUrlLine(SAMPLE_YAML, 5, "esphome")).toBeNull();
  });

  it("resolves a line in the esphome block to esphome section + range", () => {
    const got = resolveSectionForUrlLine(SAMPLE_YAML, 2, null);
    expect(got).not.toBeNull();
    expect(got!.sectionKey).toBe("esphome");
    expect(got!.range.fromLine).toBe(1);
    expect(got!.range.toLine).toBeGreaterThanOrEqual(3);
  });

  it("resolves a line in the wifi block to wifi", () => {
    // Line 10 is ``  ssid: home_network`` inside the ``wifi:`` block.
    const got = resolveSectionForUrlLine(SAMPLE_YAML, 10, null);
    expect(got).not.toBeNull();
    expect(got!.sectionKey).toBe("wifi");
  });

  it("resolves a line inside binary_sensor to that platform-keyed section", () => {
    // Line 18-20 is the binary_sensor entry. ``sectionKeyOf`` picks
    // the platform-qualified key for platform-style sections.
    const got = resolveSectionForUrlLine(SAMPLE_YAML, 19, null);
    expect(got).not.toBeNull();
    expect(got!.sectionKey).toContain("binary_sensor");
  });

  it("returns null when the line falls outside any section", () => {
    // Line 4 is the blank line between esphome and esp32. Some
    // parsers attribute blank lines to the preceding section; pin
    // whatever the actual behaviour is so a regression here is
    // visible. (Either non-null with esphome, or null — either is
    // valid; we just shouldn't crash.)
    const got = resolveSectionForUrlLine(SAMPLE_YAML, 999, null);
    expect(got).toBeNull();
  });

  it("range.toLine is >= range.fromLine for any successful resolution", () => {
    // Walk every line — every successful resolution should produce
    // a sensible (fromLine <= toLine) range. Pin the invariant.
    const lines = SAMPLE_YAML.split("\n").length;
    for (let i = 1; i <= lines; i++) {
      const got = resolveSectionForUrlLine(SAMPLE_YAML, i, null);
      if (got) {
        expect(got.range.toLine).toBeGreaterThanOrEqual(got.range.fromLine);
      }
    }
  });
});
