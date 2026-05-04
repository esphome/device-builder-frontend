import { describe, expect, it, vi } from "vitest";
import type { YamlSearchHit, YamlSearchMatch } from "../../src/api/types.js";
import {
  forEachYamlMatch,
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

describe("forEachYamlMatch", () => {
  it("returns [] for null hits", () => {
    expect(forEachYamlMatch(null, () => 1)).toEqual([]);
  });

  it("returns [] for empty hits", () => {
    expect(forEachYamlMatch([], () => 1)).toEqual([]);
  });

  it("walks each (hit, match) pair in file → match order", () => {
    const hits: YamlSearchHit[] = [
      {
        configuration: "a.yaml",
        device_name: "a",
        friendly_name: "A",
        matches: [
          { line_number: 1, line_text: "wifi:" },
          { line_number: 5, line_text: "  ssid: home" },
        ],
      },
      {
        configuration: "b.yaml",
        device_name: "b",
        friendly_name: "B",
        matches: [{ line_number: 3, line_text: "wifi:" }],
      },
    ];
    const fn = vi.fn((hit, match) => `${hit.device_name}:${match.line_number}`);
    expect(forEachYamlMatch(hits, fn)).toEqual(["a:1", "a:5", "b:3"]);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("preserves typing — caller's return type flows through", () => {
    const hits: YamlSearchHit[] = [
      {
        configuration: "a.yaml",
        device_name: "a",
        friendly_name: "A",
        matches: [{ line_number: 1, line_text: "x" }],
      },
    ];
    const out = forEachYamlMatch<{ id: string }>(hits, (hit, match) => ({
      id: `${hit.configuration}:${match.line_number}`,
    }));
    expect(out).toEqual([{ id: "a.yaml:1" }]);
  });
});
