import { describe, expect, it } from "vitest";
import {
  resolveSectionForUrlLine,
  resolveUrlLineFocus,
} from "../../src/util/url-line-resolver.js";

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

const SCRIPT_YAML = `esphome:
  name: kitchen

script:
  - id: blink
    mode: single
    then:
      - logger.log:
          format: hi
`;

describe("resolveSectionForUrlLine", () => {
  it("returns null when line is undefined", () => {
    expect(resolveSectionForUrlLine(SAMPLE_YAML, undefined)).toBeNull();
  });

  it.each([NaN, 0, -1, -100, 1.5, 7.5])(
    "returns null for invalid line value %s (URL param can be junk)",
    (badLine) => {
      // ``line`` arrives via ``Number(raw)`` from ``URLSearchParams``,
      // so a hand-crafted URL like ``?line=foo`` (NaN), ``?line=7.5``
      // (fractional), or ``?line=-1`` would otherwise feed bad input
      // to ``sectionAtLine`` / CodeMirror's ``doc.line(n)`` which
      // throws. Validate at the boundary.
      expect(resolveSectionForUrlLine(SAMPLE_YAML, badLine)).toBeNull();
    }
  );

  it("returns null when YAML is empty (still loading)", () => {
    expect(resolveSectionForUrlLine("", 5)).toBeNull();
  });

  it("resolves a line in the esphome block to esphome section + line-pinned range", () => {
    // Range is the SINGLE line the URL pointed at, not the whole
    // containing section. Editor scrolls to ``range.fromLine``;
    // widening to section.fromLine→toLine would silently land
    // every hit inside a section on the section header.
    const got = resolveSectionForUrlLine(SAMPLE_YAML, 2);
    expect(got).not.toBeNull();
    expect(got!.sectionKey).toBe("esphome");
    expect(got!.sectionFromLine).toBe(1);
    expect(got!.range).toEqual({ fromLine: 2, toLine: 2 });
  });

  it("resolves a line in the wifi block to wifi", () => {
    // Line 9 is ``  ssid: home_network`` inside the ``wifi:`` block.
    const got = resolveSectionForUrlLine(SAMPLE_YAML, 9);
    expect(got).not.toBeNull();
    expect(got!.sectionKey).toBe("wifi");
  });

  it("resolves a line inside binary_sensor to that platform-keyed section", () => {
    // Line 17 is ``  - platform: gpio`` inside binary_sensor.
    const got = resolveSectionForUrlLine(SAMPLE_YAML, 17);
    expect(got).not.toBeNull();
    expect(got!.sectionKey).toContain("binary_sensor");
  });

  it("returns null when the line is past end-of-file", () => {
    // Line 999 is way past the end of SAMPLE_YAML. Pin that
    // out-of-bounds line numbers (truncated YAML, malformed URL)
    // resolve to null rather than throwing or returning a stale
    // last-section match.
    const got = resolveSectionForUrlLine(SAMPLE_YAML, 999);
    expect(got).toBeNull();
  });

  it("two hits inside the same section land on different lines (not just the section header)", () => {
    // Regression pin for the bug where the resolver returned the
    // whole containing section's range — the editor scrolls to
    // ``range.fromLine``, so every hit inside ``binary_sensor``
    // would have landed on the platform line. Pin that the URL
    // line drives the range so deep-link to line N actually
    // lands on line N.
    const a = resolveSectionForUrlLine(SAMPLE_YAML, 18); // pin: GPIO2
    const b = resolveSectionForUrlLine(SAMPLE_YAML, 19); // name: Doorbell
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
      const got = resolveSectionForUrlLine(SAMPLE_YAML, i);
      if (got) {
        expect(got.range.toLine).toBe(got.range.fromLine);
        expect(got.range.fromLine).toBe(i);
      }
    }
  });
});

describe("resolveUrlLineFocus", () => {
  it("carries the section resolution plus both focus paths for a field line", () => {
    // Line 9 is ``  ssid: home_network``.
    const got = resolveUrlLineFocus(SAMPLE_YAML, 9, null);
    expect(got).not.toBeNull();
    expect(got!.sectionKey).toBe("wifi");
    expect(got!.range).toEqual({ fromLine: 9, toLine: 9 });
    expect(got!.fieldPath).toEqual(["ssid"]);
    expect(got!.yamlPath).toEqual(["wifi", "ssid"]);
  });

  it("indexes list entries in yamlPath", () => {
    // Line 18 is ``    pin: GPIO2`` inside binary_sensor's first item.
    const got = resolveUrlLineFocus(SAMPLE_YAML, 18, null);
    expect(got!.fieldPath).toEqual(["pin"]);
    expect(got!.yamlPath).toEqual(["binary_sensor", 0, "pin"]);
  });

  it("a section header line yields an empty fieldPath", () => {
    // Line 8 is ``wifi:`` — nothing to deep-target, section only.
    const got = resolveUrlLineFocus(SAMPLE_YAML, 8, null);
    expect(got!.sectionKey).toBe("wifi");
    expect(got!.fieldPath).toEqual([]);
  });

  it("resolves a nested automation line to the per-item section with an indexed path", () => {
    // Line 9 is ``          format: hi`` inside the script's action body.
    const got = resolveUrlLineFocus(SCRIPT_YAML, 9, null);
    expect(got).not.toBeNull();
    expect(got!.sectionKey).toBe("automation:script:blink");
    expect(got!.sectionFromLine).toBe(5);
    expect(got!.yamlPath).toEqual(["script", 0, "then", 0, "logger.log", "format"]);
  });

  it("returns the focus when the URL's section matches the line's section", () => {
    const got = resolveUrlLineFocus(SAMPLE_YAML, 9, "wifi");
    expect(got).not.toBeNull();
    expect(got!.fieldPath).toEqual(["ssid"]);
  });

  it("returns null when the URL's section disagrees with the line", () => {
    // A stale/hand-edited URL pairing ``section=esphome`` with a wifi
    // line must not flash a same-named field in the wrong form.
    expect(resolveUrlLineFocus(SAMPLE_YAML, 9, "esphome")).toBeNull();
  });

  it("propagates a null section resolution", () => {
    expect(resolveUrlLineFocus(SAMPLE_YAML, undefined, null)).toBeNull();
    expect(resolveUrlLineFocus("", 5, null)).toBeNull();
    expect(resolveUrlLineFocus(SAMPLE_YAML, 999, null)).toBeNull();
  });
});
