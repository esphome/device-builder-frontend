import { describe, expect, it } from "vitest";
import { pathsForYamlLine } from "../../src/util/yaml-cursor-paths.js";

const YAML = `esphome:
  name: kitchen

wifi:
  ssid: home
  password:

sensor:
  - platform: aht10
    temperature:
      name: Temperature
    lambda: |-
      id: looks_like_a_key
`;

describe("pathsForYamlLine", () => {
  it("derives both paths for a populated field line", () => {
    expect(pathsForYamlLine(YAML, 5)).toEqual({
      path: ["wifi", "ssid"],
      indexedPath: ["wifi", "ssid"],
    });
  });

  it("indexes block-sequence items", () => {
    expect(pathsForYamlLine(YAML, 11)!.indexedPath).toEqual([
      "sensor",
      0,
      "temperature",
      "name",
    ]);
  });

  it("anchors an empty-value pair via the indent walker", () => {
    // ``password:`` after a populated sibling — Lezer leaves the Pair
    // open, so only the walker keeps the leaf key.
    expect(pathsForYamlLine(YAML, 6)!.path).toEqual(["wifi", "password"]);
  });

  it("does not treat block-scalar content as fields", () => {
    // ``id: looks_like_a_key`` inside the lambda body is literal text.
    const got = pathsForYamlLine(YAML, 13)!;
    expect(got.path).not.toContain("id");
  });

  it("resolves a blank indented line to its ancestor chain", () => {
    const yaml = "esp32:\n  framework:\n    \nlogger:\n";
    expect(pathsForYamlLine(yaml, 3)!.path).toEqual(["esp32", "framework"]);
  });

  it("returns null for an out-of-range line", () => {
    expect(pathsForYamlLine(YAML, 0)).toBeNull();
    expect(pathsForYamlLine(YAML, 999)).toBeNull();
  });
});
