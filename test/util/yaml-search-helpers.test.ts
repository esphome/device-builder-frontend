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

  it.each([
    ["password: hunter2", "password: ••••••••"],
    ["  ap_password: 42dfadc0c2", "ap_password: ••••••••"],
    ["  - ota_password: yellow1@@", "- ota_password: ••••••••"],
    ["psk: 0123456789abcdef", "psk: ••••••••"],
  ])("masks inline credential value in %s", (raw, expectedTrimmed) => {
    const match = { line_number: 1, line_text: raw };
    expect(yamlHitLabel(HIT, match)).toBe(`Kitchen Lamp — ${expectedTrimmed}`);
  });

  it("does not mask !secret references — those are indirections, not credentials", () => {
    const match = { line_number: 1, line_text: "  password: !secret wifi_password" };
    expect(yamlHitLabel(HIT, match)).toBe(
      "Kitchen Lamp — password: !secret wifi_password"
    );
  });

  it("does not mask ${substitution} references — same indirection rule", () => {
    // ``substitutions:\n  wifi_password: ...`` followed by
    // ``wifi:\n  password: ${wifi_password}`` is the ratgdo /
    // package-config shape. The ``password`` line carries only
    // the name of an indirection, not the credential itself —
    // the credential lives in the substitutions block (which
    // *is* masked, see the ``*_password`` suffix tests below).
    const match = { line_number: 1, line_text: "  password: ${wifi_password}" };
    expect(yamlHitLabel(HIT, match)).toBe(
      "Kitchen Lamp — password: ${wifi_password}"
    );
  });

  it("does not mask non-sensitive keys", () => {
    const match = { line_number: 1, line_text: "  ssid: home_network" };
    expect(yamlHitLabel(HIT, match)).toBe("Kitchen Lamp — ssid: home_network");
  });

  it("does not mask key: under ESPHome contexts where it's a button code, not a credential", () => {
    // ``key:`` is parent-scoped sensitive (only under encryption);
    // without the parent context we deliberately don't mask it
    // here. Pin the don't-mask behaviour so a future change that
    // over-masks button codes (remote_receiver / remote_transmitter
    // commonly use ``key: <number>``) surfaces as a test failure.
    const match = { line_number: 1, line_text: "    key: 0xABCDEF12" };
    expect(yamlHitLabel(HIT, match)).toBe("Kitchen Lamp — key: 0xABCDEF12");
  });

  it.each([
    // Commented-out credentials — leak just as easily as live
    // values when surfaced in search results. Mask the value but
    // preserve the leading ``#`` so the line still reads as a
    // comment.
    ['# password: "8f0e4ddd4bb7034d1f4165ab30d84b5e"', "# password: ••••••••"],
    ["  # password: hunter2", "# password: ••••••••"],
    ["#password: hunter2", "#password: ••••••••"],
    ["## password: hunter2", "## password: ••••••••"],
    ["# - ap_password: 42dfadc0c2", "# - ap_password: ••••••••"],
  ])("masks credential value inside a YAML comment (%s)", (raw, expectedTrimmed) => {
    const match = { line_number: 1, line_text: raw };
    expect(yamlHitLabel(HIT, match)).toBe(`Kitchen Lamp — ${expectedTrimmed}`);
  });

  it.each([
    // User-defined substitution keys (``substitutions: wifi_password: …``)
    // wouldn't be in the editor's strict ``ALWAYS_SENSITIVE_KEYS`` list
    // because the user names them. The search-time heuristic catches
    // any ``*_password`` / ``*_psk`` suffix to defend against this.
    ["wifi_password: yellow1@@", "wifi_password: ••••••••"],
    ["  guest_psk: HFrhVdN37Bb6mTFm", "guest_psk: ••••••••"],
    ['  WiFi_Password: "uppercase-key"', "WiFi_Password: ••••••••"],
  ])("masks credential value for user-defined *_password / *_psk keys (%s)", (raw, expectedTrimmed) => {
    const match = { line_number: 1, line_text: raw };
    expect(yamlHitLabel(HIT, match)).toBe(`Kitchen Lamp — ${expectedTrimmed}`);
  });

  it.each([
    // Don't over-mask: keys that contain ``password`` mid-name
    // (``password_protected``) or unrelated keys aren't credentials.
    "password_protected: true",
    "max_passwords: 5",
    "key_signed: 12345",
  ])("does not mask non-credential keys (%s)", (raw) => {
    const match = { line_number: 1, line_text: raw };
    expect(yamlHitLabel(HIT, match)).toContain(raw.trim());
  });

  it("only masks in search results — editor's sensitive-scan keeps its own scope", () => {
    // Pin that the search-side masker is independent of the
    // editor's parent-scoped scan. The search-time mask is
    // intentionally wider (handles commented credentials,
    // user-named substitution keys); the editor's scan stays
    // strict. Calling ``yamlHitLabel`` doesn't reach into
    // ``findSensitiveValueRanges`` — verify by checking that
    // the editor's scan-only path (``key`` under encryption) is
    // *not* masked here.
    const match = { line_number: 1, line_text: "    key: random-noise-here" };
    expect(yamlHitLabel(HIT, match)).toBe("Kitchen Lamp — key: random-noise-here");
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
