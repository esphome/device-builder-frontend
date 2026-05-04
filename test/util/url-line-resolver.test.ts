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

  it("resolves a line in the esphome block to esphome section + line-pinned range", () => {
    // Range is the SINGLE line the URL pointed at, not the whole
    // containing section. Editor scrolls to ``range.fromLine``;
    // widening to section.fromLine→toLine would silently land
    // every hit inside a section on the section header.
    const got = resolveSectionForUrlLine(SAMPLE_YAML, 2, null);
    expect(got).not.toBeNull();
    expect(got!.sectionKey).toBe("esphome");
    expect(got!.range).toEqual({ fromLine: 2, toLine: 2 });
  });

  it("resolves a line in the wifi block to wifi", () => {
    // Line 9 is ``  ssid: home_network`` inside the ``wifi:`` block.
    const got = resolveSectionForUrlLine(SAMPLE_YAML, 9, null);
    expect(got).not.toBeNull();
    expect(got!.sectionKey).toBe("wifi");
  });

  it("resolves a line inside binary_sensor to that platform-keyed section", () => {
    // Line 17 is ``  - platform: gpio`` inside binary_sensor.
    const got = resolveSectionForUrlLine(SAMPLE_YAML, 17, null);
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

  it("two hits inside the same section land on different lines (not just the section header)", () => {
    // Regression pin for the bug where the resolver returned the
    // whole containing section's range — the editor scrolls to
    // ``range.fromLine``, so every hit inside ``binary_sensor``
    // would have landed on the platform line. Pin that the URL
    // line drives the range so deep-link to line N actually
    // lands on line N.
    const a = resolveSectionForUrlLine(SAMPLE_YAML, 18, null); // pin: GPIO2
    const b = resolveSectionForUrlLine(SAMPLE_YAML, 19, null); // name: Doorbell
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.sectionKey).toBe(b!.sectionKey);
    expect(a!.range.fromLine).toBe(18);
    expect(b!.range.fromLine).toBe(19);
  });

  it("range.toLine equals range.fromLine for any successful resolution", () => {
    // Single-line range invariant.
    const lines = SAMPLE_YAML.split("\n").length;
    for (let i = 1; i <= lines; i++) {
      const got = resolveSectionForUrlLine(SAMPLE_YAML, i, null);
      if (got) {
        expect(got.range.toLine).toBe(got.range.fromLine);
        expect(got.range.fromLine).toBe(i);
      }
    }
  });
});
