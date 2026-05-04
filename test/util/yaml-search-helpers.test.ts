import { describe, expect, it } from "vitest";
import type { YamlSearchHit, YamlSearchMatch } from "../../src/api/types.js";
import {
  yamlEmptyMessage,
  yamlEmptyMessageKey,
  yamlHitHref,
  yamlHitLabel,
} from "../../src/util/yaml-search-helpers.js";

const HIT: YamlSearchHit = {
  configuration: "kitchen.yaml",
  device_name: "kitchen",
  friendly_name: "Kitchen Lamp",
  matches: [{ line_number: 7, line_text: "  ssid: home" }],
};

const MATCH: YamlSearchMatch = HIT.matches[0];

describe("yamlHitLabel", () => {
  it("formats friendly_name + line text", () => {
    expect(yamlHitLabel(HIT, MATCH)).toBe("Kitchen Lamp — ssid: home");
  });

  it("falls back to device_name when friendly_name is empty", () => {
    const hit = { ...HIT, friendly_name: "" };
    expect(yamlHitLabel(hit, MATCH)).toBe("kitchen — ssid: home");
  });

  it("falls back to configuration when neither name is set", () => {
    const hit = { ...HIT, friendly_name: "", device_name: "" };
    expect(yamlHitLabel(hit, MATCH)).toBe("kitchen.yaml — ssid: home");
  });

  it("uses 'line N' fallback when the matched line is whitespace-only", () => {
    const match = { line_number: 12, line_text: "    " };
    expect(yamlHitLabel(HIT, match)).toBe("Kitchen Lamp — line 12");
  });

  it("trims surrounding whitespace from the line text", () => {
    const match = { line_number: 3, line_text: "    wifi:    " };
    expect(yamlHitLabel(HIT, match)).toBe("Kitchen Lamp — wifi:");
  });
});

describe("yamlHitHref", () => {
  it("builds /device/<config>?line=<n>", () => {
    expect(yamlHitHref(HIT, MATCH)).toBe("/device/kitchen.yaml?line=7");
  });

  it("URL-encodes the configuration filename", () => {
    const hit = { ...HIT, configuration: "guest room (1).yaml" };
    expect(yamlHitHref(hit, MATCH)).toBe("/device/guest%20room%20(1).yaml?line=7");
  });
});

describe("yamlEmptyMessageKey", () => {
  it("returns 'searching' when hits is null", () => {
    expect(yamlEmptyMessageKey(null)).toBe("yaml_search.searching");
  });

  it("returns 'no_matches' when hits is an empty array", () => {
    expect(yamlEmptyMessageKey([])).toBe("yaml_search.no_matches");
  });

  it("returns null when there are hits to render", () => {
    expect(yamlEmptyMessageKey([HIT])).toBeNull();
  });
});

describe("yamlEmptyMessage", () => {
  // The localize stub passes the key through as-is so the
  // test assertions don't depend on the specific en.json values.
  const passthroughLocalize = (k: string) => k;

  it("resolves the key through the localize function for empty states", () => {
    expect(yamlEmptyMessage(passthroughLocalize, null)).toBe("yaml_search.searching");
    expect(yamlEmptyMessage(passthroughLocalize, [])).toBe("yaml_search.no_matches");
  });

  it("returns empty string when there are hits (caller renders rows)", () => {
    expect(yamlEmptyMessage(passthroughLocalize, [HIT])).toBe("");
  });
});
