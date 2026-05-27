import { describe, expect, it, vi } from "vitest";
import type { YamlSearchHit, YamlSearchMatch } from "../../src/api/types.js";
import {
  buildYamlSnippetBlocks,
  forEachYamlMatch,
  yamlEmptyMessage,
  yamlEmptyMessageKey,
  yamlHitDeviceLabel,
  yamlHitHref,
  yamlHitLabel,
  yamlSnippetBlockHref,
} from "../../src/util/yaml-search-helpers.js";

/**
 * Build a ``YamlSearchMatch`` with sensible defaults.
 *
 * Most label / mask tests don't care about the context windows;
 * they only assert on ``line_text``. The factory keeps those
 * cases readable (``mkMatch({ line_text: "wifi:" })``) without
 * sprinkling ``before: [], after: []`` through every fixture,
 * and centralises the wire-shape compatibility — when the
 * backend adds another match-level field, only this helper
 * changes.
 */
function mkMatch(overrides: Partial<YamlSearchMatch> = {}): YamlSearchMatch {
  return {
    line_number: 1,
    line_text: "",
    before: [],
    after: [],
    ...overrides,
  };
}

/** Build a ``YamlSearchHit`` with a single match unless overridden. */
function mkHit(overrides: Partial<YamlSearchHit> = {}): YamlSearchHit {
  return {
    configuration: "kitchen.yaml",
    device_name: "kitchen",
    friendly_name: "Kitchen Lamp",
    matches: [mkMatch({ line_number: 7, line_text: "  ssid: home" })],
    ...overrides,
  };
}

const HIT: YamlSearchHit = mkHit();
const MATCH: YamlSearchMatch = HIT.matches[0];

describe("yamlHitLabel", () => {
  it("formats friendly_name + line text", () => {
    expect(yamlHitLabel(HIT, MATCH)).toBe("Kitchen Lamp — ssid: home");
  });

  it("falls back to device_name when friendly_name is empty", () => {
    expect(yamlHitLabel(mkHit({ friendly_name: "" }), MATCH)).toBe(
      "kitchen — ssid: home"
    );
  });

  it("falls back to configuration when neither name is set", () => {
    expect(yamlHitLabel(mkHit({ friendly_name: "", device_name: "" }), MATCH)).toBe(
      "kitchen.yaml — ssid: home"
    );
  });

  it("uses 'line N' fallback when the matched line is whitespace-only", () => {
    expect(yamlHitLabel(HIT, mkMatch({ line_number: 12, line_text: "    " }))).toBe(
      "Kitchen Lamp — line 12"
    );
  });

  it("trims surrounding whitespace from the line text", () => {
    expect(
      yamlHitLabel(HIT, mkMatch({ line_number: 3, line_text: "    wifi:    " }))
    ).toBe("Kitchen Lamp — wifi:");
  });

  it.each([
    ["password: hunter2", "password: ••••••••"],
    ["  ap_password: 42dfadc0c2", "ap_password: ••••••••"],
    ["  - ota_password: yellow1@@", "- ota_password: ••••••••"],
    ["psk: 0123456789abcdef", "psk: ••••••••"],
  ])("masks inline credential value in %s", (raw, expectedTrimmed) => {
    expect(yamlHitLabel(HIT, mkMatch({ line_text: raw }))).toBe(
      `Kitchen Lamp — ${expectedTrimmed}`
    );
  });

  it("does not mask !secret references — those are indirections, not credentials", () => {
    expect(
      yamlHitLabel(HIT, mkMatch({ line_text: "  password: !secret wifi_password" }))
    ).toBe("Kitchen Lamp — password: !secret wifi_password");
  });

  it("does not mask ${substitution} references — same indirection rule", () => {
    // ``substitutions:\n  wifi_password: ...`` followed by
    // ``wifi:\n  password: ${wifi_password}`` is the ratgdo /
    // package-config shape. The ``password`` line carries only
    // the name of an indirection, not the credential itself —
    // the credential lives in the substitutions block (which
    // *is* masked, see the ``*_password`` suffix tests below).
    expect(
      yamlHitLabel(HIT, mkMatch({ line_text: "  password: ${wifi_password}" }))
    ).toBe("Kitchen Lamp — password: ${wifi_password}");
  });

  it("does not mask non-sensitive keys", () => {
    expect(yamlHitLabel(HIT, mkMatch({ line_text: "  ssid: home_network" }))).toBe(
      "Kitchen Lamp — ssid: home_network"
    );
  });

  it("does not mask key: under ESPHome contexts where it's a button code, not a credential", () => {
    // ``key:`` is parent-scoped sensitive (only under encryption);
    // without the parent context we deliberately don't mask it
    // here. Pin the don't-mask behaviour so a future change that
    // over-masks button codes (remote_receiver / remote_transmitter
    // commonly use ``key: <number>``) surfaces as a test failure.
    expect(yamlHitLabel(HIT, mkMatch({ line_text: "    key: 0xABCDEF12" }))).toBe(
      "Kitchen Lamp — key: 0xABCDEF12"
    );
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
    expect(yamlHitLabel(HIT, mkMatch({ line_text: raw }))).toBe(
      `Kitchen Lamp — ${expectedTrimmed}`
    );
  });

  it.each([
    // User-defined substitution keys (``substitutions: wifi_password: …``)
    // wouldn't be in the editor's strict ``ALWAYS_SENSITIVE_KEYS`` list
    // because the user names them. The search-time heuristic catches
    // any ``*_password`` / ``*_psk`` suffix to defend against this.
    ["wifi_password: yellow1@@", "wifi_password: ••••••••"],
    ["  guest_psk: HFrhVdN37Bb6mTFm", "guest_psk: ••••••••"],
    ['  WiFi_Password: "uppercase-key"', "WiFi_Password: ••••••••"],
  ])(
    "masks credential value for user-defined *_password / *_psk keys (%s)",
    (raw, expectedTrimmed) => {
      expect(yamlHitLabel(HIT, mkMatch({ line_text: raw }))).toBe(
        `Kitchen Lamp — ${expectedTrimmed}`
      );
    }
  );

  it.each([
    // Don't over-mask: keys that contain ``password`` mid-name
    // (``password_protected``) or unrelated keys aren't credentials.
    "password_protected: true",
    "max_passwords: 5",
    "key_signed: 12345",
  ])("does not mask non-credential keys (%s)", (raw) => {
    expect(yamlHitLabel(HIT, mkMatch({ line_text: raw }))).toContain(raw.trim());
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
    expect(yamlHitLabel(HIT, mkMatch({ line_text: "    key: random-noise-here" }))).toBe(
      "Kitchen Lamp — key: random-noise-here"
    );
  });
});

describe("yamlHitHref", () => {
  it("builds /device/<config>?line=<n>", () => {
    expect(yamlHitHref(HIT, MATCH)).toBe("/device/kitchen.yaml?line=7");
  });

  it("URL-encodes the configuration filename", () => {
    expect(yamlHitHref(mkHit({ configuration: "guest room (1).yaml" }), MATCH)).toBe(
      "/device/guest%20room%20(1).yaml?line=7"
    );
  });
});

describe("yamlHitDeviceLabel", () => {
  it("uses friendly_name when set", () => {
    expect(yamlHitDeviceLabel(HIT)).toBe("Kitchen Lamp");
  });

  it("falls back to device_name when friendly_name is empty", () => {
    expect(yamlHitDeviceLabel(mkHit({ friendly_name: "" }))).toBe("kitchen");
  });

  it("falls back to configuration when neither name is set", () => {
    expect(yamlHitDeviceLabel(mkHit({ friendly_name: "", device_name: "" }))).toBe(
      "kitchen.yaml"
    );
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
      mkHit({
        configuration: "a.yaml",
        device_name: "a",
        friendly_name: "A",
        matches: [
          mkMatch({ line_number: 1, line_text: "wifi:" }),
          mkMatch({ line_number: 5, line_text: "  ssid: home" }),
        ],
      }),
      mkHit({
        configuration: "b.yaml",
        device_name: "b",
        friendly_name: "B",
        matches: [mkMatch({ line_number: 3, line_text: "wifi:" })],
      }),
    ];
    const fn = vi.fn((hit, match) => `${hit.device_name}:${match.line_number}`);
    expect(forEachYamlMatch(hits, fn)).toEqual(["a:1", "a:5", "b:3"]);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("preserves typing — caller's return type flows through", () => {
    const hits: YamlSearchHit[] = [
      mkHit({
        configuration: "a.yaml",
        device_name: "a",
        friendly_name: "A",
        matches: [mkMatch({ line_text: "x" })],
      }),
    ];
    const out = forEachYamlMatch<{ id: string }>(hits, (hit, match) => ({
      id: `${hit.configuration}:${match.line_number}`,
    }));
    expect(out).toEqual([{ id: "a.yaml:1" }]);
  });
});

describe("buildYamlSnippetBlocks", () => {
  it("returns [] for an empty matches list", () => {
    expect(buildYamlSnippetBlocks([])).toEqual([]);
  });

  it("turns a single match into one block spanning context + match", () => {
    const m = mkMatch({
      line_number: 5,
      line_text: "wifi:",
      before: ["esphome:", "  name: kitchen"],
      after: ["  ssid: home", "  api:"],
    });

    const [block] = buildYamlSnippetBlocks([m]);

    expect(block.startLine).toBe(3);
    expect(block.endLine).toBe(7);
    expect(block.lines).toEqual([
      "esphome:",
      "  name: kitchen",
      "wifi:",
      "  ssid: home",
      "  api:",
    ]);
    expect([...block.matchedLines]).toEqual([5]);
  });

  it("merges adjacent matches whose context windows overlap", () => {
    // Two matches in the same file at lines 5 and 7 with a
    // ±2-line context window each. The windows overlap (5's
    // ``after`` ends at 7, 7's ``before`` starts at 5), so the
    // result must be ONE block spanning 3..9 with two matched
    // lines, not two blocks with duplicated context rows.
    const matches = [
      mkMatch({
        line_number: 5,
        line_text: "wifi:",
        before: ["esphome:", "  name: kitchen"],
        after: ["  ssid: home", "binary_sensor:"],
      }),
      mkMatch({
        line_number: 7,
        line_text: "binary_sensor:",
        before: ["wifi:", "  ssid: home"],
        after: ["  - platform: gpio", "    name: door"],
      }),
    ];

    const blocks = buildYamlSnippetBlocks(matches);

    expect(blocks).toHaveLength(1);
    const [block] = blocks;
    expect(block.startLine).toBe(3);
    expect(block.endLine).toBe(9);
    expect(block.lines).toEqual([
      "esphome:",
      "  name: kitchen",
      "wifi:",
      "  ssid: home",
      "binary_sensor:",
      "  - platform: gpio",
      "    name: door",
    ]);
    expect([...block.matchedLines].sort()).toEqual([5, 7]);
  });

  it("keeps non-overlapping matches as separate blocks", () => {
    // Match at line 3 with ±2 context (lines 1..5) and match at
    // line 50 with ±2 context (lines 48..52) — the windows are
    // far apart, so each is its own block.
    const matches = [
      mkMatch({
        line_number: 3,
        line_text: "wifi:",
        before: ["esphome:", "  name: kitchen"],
        after: ["  ssid: home", "  password: x"],
      }),
      mkMatch({
        line_number: 50,
        line_text: "binary_sensor:",
        before: ["", "switch:"],
        after: ["  - platform: gpio", ""],
      }),
    ];

    const blocks = buildYamlSnippetBlocks(matches);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[0].endLine).toBe(5);
    expect([...blocks[0].matchedLines]).toEqual([3]);
    expect(blocks[1].startLine).toBe(48);
    expect(blocks[1].endLine).toBe(52);
    expect([...blocks[1].matchedLines]).toEqual([50]);
  });

  it("handles a match at the file edge (before / after partly empty)", () => {
    // Backend clamps the context window at file edges. Pin
    // that we don't synthesise lines we don't have — the block
    // shrinks to whatever ``before`` / ``after`` actually
    // contain.
    const m = mkMatch({
      line_number: 1,
      line_text: "esphome:",
      before: [],
      after: ["  name: kitchen", "  friendly_name: Kitchen"],
    });

    const [block] = buildYamlSnippetBlocks([m]);

    expect(block.startLine).toBe(1);
    expect(block.endLine).toBe(3);
    expect(block.lines).toEqual([
      "esphome:",
      "  name: kitchen",
      "  friendly_name: Kitchen",
    ]);
  });

  it("masks credential values in context lines too", () => {
    // The ``password:`` line happens to be a *context* line
    // for a match on the surrounding ``wifi:`` block, not the
    // matched line itself — so masking has to apply to
    // ``before`` / ``after`` content, not just ``line_text``.
    // Otherwise a search for ``ssid`` would leak the password
    // value in the rendered snippet.
    const m = mkMatch({
      line_number: 3,
      line_text: "  ssid: home",
      before: ["wifi:"],
      after: ["  password: hunter2"],
    });

    const [block] = buildYamlSnippetBlocks([m]);

    expect(block.lines).toEqual(["wifi:", "  ssid: home", "  password: ••••••••"]);
  });

  it("masks the API encryption key when its parent is in the snippet window", () => {
    // ``key:`` is parent-scoped sensitive (only under
    // ``encryption:`` — generic ``key:`` is also used for
    // non-sensitive button codes). Single-line masking can't
    // make this call, but a snippet block carries enough
    // surrounding lines for the multi-line scanner to see the
    // parent. Pin that a search for ``api`` (matched line ``api:``)
    // masks the encryption key sitting two lines below in the
    // ``after`` window.
    const m = mkMatch({
      line_number: 5,
      line_text: "api:",
      before: ["esphome:", "  name: kitchen"],
      after: ["  encryption:", "    key: AAABBBCCCDDDEEEFFFGGG="],
    });

    const [block] = buildYamlSnippetBlocks([m]);

    expect(block.lines).toEqual([
      "esphome:",
      "  name: kitchen",
      "api:",
      "  encryption:",
      "    key: ••••••••",
    ]);
  });

  it("does not mask a bare ``key:`` line when its parent is outside the window", () => {
    // The scanner walks the block top-to-bottom; if the
    // ``encryption:`` parent isn't included, ``key:`` reads as a
    // plain (non-sensitive) field — same as a button code under
    // ``remote_receiver``. Pin the don't-over-mask behaviour so
    // this fallback case stays consistent with the editor's scan.
    const m = mkMatch({
      line_number: 9,
      line_text: "    key: 0xABCDEF12",
      before: ["    - protocol: NEC", "      data: 0x00FF"],
      after: ["    - protocol: NEC"],
    });

    const [block] = buildYamlSnippetBlocks([m]);

    expect(block.lines).toEqual([
      "    - protocol: NEC",
      "      data: 0x00FF",
      "    key: 0xABCDEF12",
      "    - protocol: NEC",
    ]);
  });

  it("preserves trailing comments when the scanner masks a value", () => {
    // ``findSensitiveValueRanges`` returns a precise
    // ``[valueFrom, valueTo)`` range so the slice replacement
    // keeps any trailing ``# comment`` untouched. The single-line
    // ``maskSensitiveLine`` would clobber it via the wholesale
    // ``${prefix}${key}: ••••••••`` rewrite — pin that the
    // scanner-driven path is preferred.
    const m = mkMatch({
      line_number: 2,
      line_text: "wifi:",
      before: [],
      after: ["  password: hunter2  # admin pwd"],
    });

    const [block] = buildYamlSnippetBlocks([m]);

    expect(block.lines).toEqual(["wifi:", "  password: ••••••••  # admin pwd"]);
  });

  it("falls back to the single-line heuristic for commented credentials", () => {
    // The scanner's ``KEY_LINE`` doesn't match a leading ``#``,
    // so commented-out credentials only get masked by the
    // post-scanner single-line pass. Pin that the fallback runs.
    const m = mkMatch({
      line_number: 2,
      line_text: "wifi:",
      before: [],
      after: ["  # password: hunter2"],
    });

    const [block] = buildYamlSnippetBlocks([m]);

    expect(block.lines).toEqual(["wifi:", "  # password: ••••••••"]);
  });

  it("keeps ${substitution} indirections visible on context lines", () => {
    // The matched-line path (``yamlHitLabel``) deliberately
    // leaves ``${wifi_password}`` and ``!secret wifi_password``
    // visible — they carry only the *name* of an indirection,
    // not the credential. The scanner-driven block mask doesn't
    // natively skip ``${...}`` (only ``!secret``), so without a
    // filter the snippet renderer would mask substitution
    // references while the command-palette labels still show
    // them. Pin the consistency: the ``password:
    // ${wifi_password}`` reference stays visible in a context
    // line, while the actual substitution definition further
    // down (``wifi_password: yellow1@@``) gets masked via the
    // suffix heuristic.
    const m = mkMatch({
      line_number: 4,
      line_text: "wifi:",
      before: ["substitutions:", "  wifi_password: yellow1@@", ""],
      after: ["  ssid: home", "  password: ${wifi_password}"],
    });

    const [block] = buildYamlSnippetBlocks([m]);

    expect(block.lines).toEqual([
      "substitutions:",
      "  wifi_password: ••••••••",
      "",
      "wifi:",
      "  ssid: home",
      "  password: ${wifi_password}",
    ]);
  });

  it("falls back to the *_password suffix heuristic on context lines", () => {
    // User-defined ``substitutions: wifi_password: …`` shape —
    // not in the scanner's ``ALWAYS_SENSITIVE_KEYS`` allowlist,
    // so the single-line suffix heuristic catches it on the
    // post-scanner pass.
    const m = mkMatch({
      line_number: 2,
      line_text: "substitutions:",
      before: [],
      after: ["  wifi_password: yellow1@@"],
    });

    const [block] = buildYamlSnippetBlocks([m]);

    expect(block.lines).toEqual(["substitutions:", "  wifi_password: ••••••••"]);
  });
});

describe("yamlSnippetBlockHref", () => {
  it("links to the block's first matched line, not its start line", () => {
    // The block spans context lines 3..7 with a single match
    // at line 5. Linking to ``startLine`` would land the
    // editor cursor on a context line — pin that we use the
    // first match in the block instead.
    const m = mkMatch({
      line_number: 5,
      line_text: "wifi:",
      before: ["esphome:", "  name: kitchen"],
      after: ["  ssid: home", "  password: x"],
    });
    const [block] = buildYamlSnippetBlocks([m]);

    expect(yamlSnippetBlockHref(HIT, block)).toBe("/device/kitchen.yaml?line=5");
  });

  it("URL-encodes the configuration filename", () => {
    const m = mkMatch({ line_number: 5, line_text: "wifi:" });
    const [block] = buildYamlSnippetBlocks([m]);

    expect(
      yamlSnippetBlockHref(mkHit({ configuration: "guest room (1).yaml" }), block)
    ).toBe("/device/guest%20room%20(1).yaml?line=5");
  });
});
