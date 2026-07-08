/**
 * Tests for the linter's last-result cache exposed to the save flow.
 *
 * The CodeMirror linter populates `_lastValidated` after every
 * successful backend call. The save path in ``pages/device.ts``
 * reads it via ``getLastValidatedResult`` and skips its own
 * ``validateYaml`` round-trip when the buffer matches exactly.
 *
 * Each test resets the module so the in-module map starts empty;
 * a leaked entry from a prior test would surface here as a
 * spurious cache hit and any save-flow regression that swapped
 * the buffer-equality check for something looser would surface
 * in ``returns_null_for_different_content``.
 */

import { EditorState } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
});

describe("retargetBlockDiagnostic", () => {
  const DOC = [
    "esphome:", // 0
    "  name: test", // 1
    "  friendly_name: test", // 2
    "", // 3
    "# Replace with your platform", // 4
    "esp8266:", // 5
    "  board: esp01_1m", // 6
    "", // 7
    "apccci:", // 8
    "  id: api_server", // 9
    "  encryption:", // 10
    '    key: "x"', // 11
  ].join("\n");

  /** Char offset of the first occurrence of `text` in DOC. */
  const offsetOf = (text: string) => DOC.indexOf(text);

  it("snaps a multi-line 'Component not found' child range onto the key", async () => {
    const { retargetBlockDiagnostic } =
      await import("../../src/util/yaml-lint-backend.js");
    const doc = EditorState.create({ doc: DOC }).doc;
    // esphome marks the value mapping → spans the `id:`…`key:` children.
    const fallback = { from: offsetOf("  id: api_server") + 2, to: offsetOf('"x"') + 3 };
    const { from, to } = retargetBlockDiagnostic(doc, fallback);
    expect(doc.sliceString(from, to)).toBe("apccci");
  });

  it("snaps a 'Platform missing' esphome-block range onto the esphome key", async () => {
    const { retargetBlockDiagnostic } =
      await import("../../src/util/yaml-lint-backend.js");
    const doc = EditorState.create({ doc: DOC }).doc;
    // esphome marks the esphome value mapping → spans name…the comment.
    const fallback = { from: offsetOf("  name: test") + 2, to: offsetOf("esp8266:") };
    const { from, to } = retargetBlockDiagnostic(doc, fallback);
    expect(doc.sliceString(from, to)).toBe("esphome");
  });

  it("leaves a single-line range untouched (already precise / key-marked)", async () => {
    const { retargetBlockDiagnostic } =
      await import("../../src/util/yaml-lint-backend.js");
    const doc = EditorState.create({ doc: DOC }).doc;
    const keyStart = offsetOf("apccci:");
    expect(retargetBlockDiagnostic(doc, { from: keyStart, to: keyStart + 6 })).toEqual({
      from: keyStart,
      to: keyStart + 6,
    });
  });

  it("clamps to the first line when the block has no enclosing key", async () => {
    const { retargetBlockDiagnostic } =
      await import("../../src/util/yaml-lint-backend.js");
    const doc = EditorState.create({ doc: DOC }).doc;
    // A multi-line range starting at a top-level key (no shallower line above).
    const apccciLine = doc.lineAt(offsetOf("apccci:"));
    const fallback = { from: apccciLine.from, to: offsetOf('"x"') + 3 };
    const { from, to } = retargetBlockDiagnostic(doc, fallback);
    expect(from).toBe(apccciLine.from);
    expect(to).toBe(apccciLine.to);
    expect(doc.sliceString(from, to)).toBe("apccci:");
  });

  it("passes through a range trimmed of blank-line spill as single-line content", async () => {
    const { retargetBlockDiagnostic, trimRangeToContent } =
      await import("../../src/util/yaml-lint-backend.js");
    const doc = EditorState.create({ doc: DOC }).doc;
    // esphome's end mark often lands at column 0 past a blank separator
    // (a last-list-item range); walking up to the enclosing key there
    // would attribute the error to the whole block instead of the item.
    const boardLine = doc.lineAt(offsetOf("  board: esp01_1m"));
    const raw = { from: boardLine.from + 2, to: offsetOf("apccci:") };
    const trimmed = trimRangeToContent(doc, raw);
    expect(trimmed).toEqual({ from: boardLine.from + 2, to: boardLine.to });
    expect(retargetBlockDiagnostic(doc, trimmed)).toEqual(trimmed);
  });
});

describe("sanitizeMessage", () => {
  it("collapses a POSIX absolute path to its basename", async () => {
    const { sanitizeMessage } = await import("../../src/util/yaml-lint-backend.js");
    expect(
      sanitizeMessage('in "/Users/bdraco/esphome/foo.yaml", line 17, column 2')
    ).toBe('in "foo.yaml", line 17, column 2');
  });

  it("collapses a Windows absolute path to its basename", async () => {
    const { sanitizeMessage } = await import("../../src/util/yaml-lint-backend.js");
    expect(sanitizeMessage('in "C:\\Users\\bdraco\\esphome\\foo.yaml"')).toBe(
      'in "foo.yaml"'
    );
  });

  it("strips every quoted path and leaves bare filenames untouched", async () => {
    const { sanitizeMessage } = await import("../../src/util/yaml-lint-backend.js");
    expect(
      sanitizeMessage('"/a/b/x.yaml" includes "/c/d/y.yaml" but "z.yaml" stays')
    ).toBe('"x.yaml" includes "y.yaml" but "z.yaml" stays');
  });
});

describe("parseYamlErrorPosition", () => {
  it("returns the last (problem-mark) line/column, not the first", async () => {
    const { parseYamlErrorPosition } =
      await import("../../src/util/yaml-lint-backend.js");
    const msg =
      "while parsing a block mapping in x, line 1, column 1 expected <block end>, " +
      "but found '<scalar>' in x, line 17, column 2";
    expect(parseYamlErrorPosition(msg)).toEqual({ line: 17, col: 2 });
  });

  it("falls back to a bare `line N` with a null column", async () => {
    const { parseYamlErrorPosition } =
      await import("../../src/util/yaml-lint-backend.js");
    expect(
      parseYamlErrorPosition("could not determine a constructor for line 4")
    ).toEqual({
      line: 4,
      col: null,
    });
  });

  it("returns null when the message carries no position", async () => {
    const { parseYamlErrorPosition } =
      await import("../../src/util/yaml-lint-backend.js");
    expect(parseYamlErrorPosition("mapping values are not allowed here")).toBeNull();
  });
});

describe("describeNestedListValue", () => {
  const localize = (key: string, values?: Record<string, string | number>): string =>
    values ? `${key}:${JSON.stringify(values)}` : key;

  it("names the nested-list misindent behind 'expected a dictionary.'", async () => {
    const { describeNestedListValue } =
      await import("../../src/util/yaml-lint-backend.js");
    const doc = [
      "    effects:", // 1
      "    - addressable_twinkle:", // 2
      "      - flicker:", // 3
      "      - pulse:", // 4
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    expect(describeNestedListValue(read, 2, localize)).toBe(
      'yaml_editor.error_nested_list_hint:{"key":"addressable_twinkle"}'
    );
  });

  it("stays silent for a key with a real value or aligned siblings", async () => {
    const { describeNestedListValue } =
      await import("../../src/util/yaml-lint-backend.js");
    const aligned = (n: number): string | undefined =>
      ["    effects:", "      - addressable_twinkle:", "      - flicker:"][n - 1];
    expect(describeNestedListValue(aligned, 2, localize)).toBeNull();
    const valued = (n: number): string | undefined =>
      ["    - platform: gpio", "      - nested:"][n - 1];
    expect(describeNestedListValue(valued, 1, localize)).toBeNull();
  });
});

describe("describeValueTypeCause", () => {
  const localize = (key: string, values?: Record<string, string | number>): string =>
    values ? `${key}:${JSON.stringify(values)}` : key;

  it("names a bare half-typed word that became the key's string value", async () => {
    const { describeValueTypeCause } =
      await import("../../src/util/yaml-lint-backend.js");
    const doc = (n: number): string | undefined => ["logger:", "  le"][n - 1];
    expect(describeValueTypeCause(doc, 2, localize)).toBe(
      'yaml_editor.error_missing_colon_hint:{"line":2,"key":"le"}'
    );
    const keyed = (n: number): string | undefined => ["logger:", "  level: DEBUG"][n - 1];
    expect(describeValueTypeCause(keyed, 2, localize)).toBeNull();
  });
});

describe("analyzeIndentMismatch", () => {
  // The reproduction: dash at column 0, properties indented 4 spaces.
  const lines = [
    "sensor:", // 1
    "- platform: dht", // 2
    "    model: DHT11", // 3
    "    pin: GPIO0", // 4
  ];
  const readLine = (n: number): string | undefined => lines[n - 1];

  it("pinpoints the misaligned list-item marker, key, and space delta", async () => {
    const { analyzeIndentMismatch } = await import("../../src/util/yaml-lint-backend.js");
    expect(analyzeIndentMismatch(readLine, 3)).toEqual({
      markerLine: 2,
      markerKey: "platform",
      delta: 2,
      reason: "props-below",
    });
  });

  it("returns null when the item and its properties already line up", async () => {
    const { analyzeIndentMismatch } = await import("../../src/util/yaml-lint-backend.js");
    const ok = (n: number): string | undefined =>
      ["sensor:", "  - platform: dht", "    model: DHT11"][n - 1];
    expect(analyzeIndentMismatch(ok, 3)).toBeNull();
  });

  it("returns null when no list-item marker precedes the error line", async () => {
    const { analyzeIndentMismatch } = await import("../../src/util/yaml-lint-backend.js");
    const plain = (n: number): string | undefined =>
      ["esphome:", "  name: x", "  bogus: y"][n - 1];
    expect(analyzeIndentMismatch(plain, 3)).toBeNull();
  });

  // The mirror shape: the marker itself dedented out of its list, which the
  // scanner blames directly ("expected <block end>, but found '-'").
  it("pinpoints an under-indented marker from the properties below it", async () => {
    const { analyzeIndentMismatch } = await import("../../src/util/yaml-lint-backend.js");
    const dedented = (n: number): string | undefined =>
      [
        "time:", // 1
        "  - platform: homeassistant", // 2
        "    id: ha_time", // 3
        "", // 4
        "- platform: sntp", // 5
        "    id: sntp_time", // 6
        "    servers: kkk", // 7
      ][n - 1];
    expect(analyzeIndentMismatch(dedented, 5)).toEqual({
      markerLine: 5,
      markerKey: "platform",
      delta: 2,
      reason: "props-below",
    });
  });

  it("returns null for a blamed marker followed by a shallower sibling", async () => {
    const { analyzeIndentMismatch } = await import("../../src/util/yaml-lint-backend.js");
    const bare = (n: number): string | undefined =>
      ["time:", "- platform: sntp", "sensor:"][n - 1];
    expect(analyzeIndentMismatch(bare, 2)).toBeNull();
  });

  it("returns null for a blamed marker whose properties already line up", async () => {
    const { analyzeIndentMismatch } = await import("../../src/util/yaml-lint-backend.js");
    const aligned = (n: number): string | undefined =>
      ["time:", "- platform: sntp", "  id: sntp_time"][n - 1];
    expect(analyzeIndentMismatch(aligned, 2)).toBeNull();
  });

  // Sibling alignment: a marker one space off from the marker above it, in
  // either direction ("expected <block end>, but found '<block sequence
  // start>'" blames the odd marker directly).
  it("dedents a blamed marker sitting deeper than the marker above it", async () => {
    const { analyzeIndentMismatch } = await import("../../src/util/yaml-lint-backend.js");
    const doc = (n: number): string | undefined =>
      [
        "    effects:", // 1
        "      - addressable_twinkle:", // 2
        "      - flicker:", // 3
        "       - pulse:", // 4
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 4)).toEqual({
      markerLine: 4,
      markerKey: "pulse",
      delta: -1,
      reason: "align",
    });
  });

  it("indents a blamed marker sitting shallower than the marker above it", async () => {
    const { analyzeIndentMismatch } = await import("../../src/util/yaml-lint-backend.js");
    const doc = (n: number): string | undefined =>
      [
        "    effects:", // 1
        "      - addressable_twinkle:", // 2
        "     - flicker:", // 3
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 3)).toEqual({
      markerLine: 3,
      markerKey: "flicker",
      delta: 1,
      reason: "align",
    });
  });

  it("skips the previous item's properties to find the sibling marker", async () => {
    const { analyzeIndentMismatch } = await import("../../src/util/yaml-lint-backend.js");
    const doc = (n: number): string | undefined =>
      [
        "time:", // 1
        "  - platform: homeassistant", // 2
        "    id: homeassistant_time", // 3
        "", // 4
        "   - platform: sntp", // 5
        "    id: sntp_time", // 6
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 5)).toEqual({
      markerLine: 5,
      markerKey: "platform",
      delta: -1,
      reason: "align",
    });
  });

  it("won't guess a sibling alignment beyond a few spaces", async () => {
    const { analyzeIndentMismatch } = await import("../../src/util/yaml-lint-backend.js");
    const doc = (n: number): string | undefined =>
      [
        "  - platform: x", // 1
        "    effects:", // 2
        "      - twinkle:", // 3
        " - platform: y", // 4
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 4)).toBeNull();
  });

  // Property alignment: the blamed property is the odd one out when its
  // siblings already sit at the marker's content column.
  it("indents a blamed property indented less than its siblings", async () => {
    const { analyzeIndentMismatch } = await import("../../src/util/yaml-lint-backend.js");
    const doc = (n: number): string | undefined =>
      [
        "output:", // 1
        "   - platform: ledc", // 2
        "     pin: 18", // 3
        "    id: buzzer_output", // 4
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 4)).toEqual({
      markerLine: 4,
      markerKey: "id",
      delta: 1,
      reason: "align",
    });
  });

  it("dedents a blamed property indented deeper than an aligned sibling", async () => {
    const { analyzeIndentMismatch } = await import("../../src/util/yaml-lint-backend.js");
    const doc = (n: number): string | undefined =>
      [
        "output:", // 1
        "   - platform: ledc", // 2
        "     pin: 18", // 3
        "      id: buzzer_output", // 4
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 4)).toEqual({
      markerLine: 4,
      markerKey: "id",
      delta: -1,
      reason: "align",
    });
  });
});

describe("describeYamlError", () => {
  // Echo the key + interpolated values so a hit is distinguishable from raw.
  const localize = (key: string, values?: Record<string, string | number>): string =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  const pos = (line: number) => ({ line, col: 1 });
  const dhtLines = ["sensor:", "- platform: dht", "    model: DHT11"];
  const readDht = (n: number): string | undefined => dhtLines[n - 1];

  it("gives the exact indentation fix + auto-fix when the document pinpoints it", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    expect(
      describeYamlError("mapping values are not allowed here", pos(3), localize, readDht)
    ).toEqual({
      text: 'yaml_editor.error_indent_fix:{"line":2,"key":"platform","spaces":2}',
      jumpLine: 2,
      fix: { line: 2, indent: 2, key: "platform" },
    });
  });

  it("falls back to the generic indentation hint (no auto-fix) when it can't pinpoint", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    // No readLine, so no document to analyze.
    expect(
      describeYamlError("mapping values are not allowed here", pos(9), localize)
    ).toEqual({ text: 'yaml_editor.error_indent_hint:{"line":9}', jumpLine: 9 });
  });

  it("falls back to the generic hint (no auto-fix) when the document has no mismatch", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    // readLine present, but the item and its properties already line up.
    const aligned = ["sensor:", "  - platform: dht", "    model: DHT11"];
    const read = (n: number): string | undefined => aligned[n - 1];
    expect(
      describeYamlError("mapping values are not allowed here", pos(3), localize, read)
    ).toEqual({ text: 'yaml_editor.error_indent_hint:{"line":3}', jumpLine: 3 });
  });

  // Real PyYAML shape for a bare `kkk` inside a list item: the context mark
  // (first position) names the word's own line; the problem mark (last)
  // blames wherever scanning gave up, lines later.
  it("names the bare key missing its ':' instead of the indent hint", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    const doc = [
      "time:", // 1
      "  - platform: homeassistant", // 2
      "    id: ha_time", // 3
      "    kkk", // 4
      "", // 5
      "  - platform: sntp", // 6
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    const msg =
      'while scanning a simple key\n  in "x.yaml", line 4, column 5\n' +
      "could not find expected ':'\n  in \"x.yaml\", line 6, column 3";
    expect(describeYamlError(msg, { line: 6, col: 3 }, localize, read)).toEqual({
      text: 'yaml_editor.error_missing_colon_hint:{"line":4,"key":"kkk"}',
      jumpLine: 4,
      squiggleLine: 4,
    });
  });

  it("keeps the indent hint for a missing ':' whose context line has one", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    const aligned = ["sensor:", "  - platform: dht", "    model: DHT11"];
    const read = (n: number): string | undefined => aligned[n - 1];
    const msg =
      'while scanning a simple key\n  in "x.yaml", line 2, column 3\n' +
      "could not find expected ':'\n  in \"x.yaml\", line 3, column 1";
    expect(describeYamlError(msg, { line: 3, col: 1 }, localize, read).text).toBe(
      'yaml_editor.error_indent_hint:{"line":3}'
    );
  });

  it("names the sibling-alignment fix with a signed dedent", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    const doc = [
      "    effects:", // 1
      "      - addressable_twinkle:", // 2
      "      - flicker:", // 3
      "       - pulse:", // 4
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    expect(
      describeYamlError(
        "expected <block end>, but found '<block sequence start>'",
        { line: 4, col: 8 },
        localize,
        read
      )
    ).toEqual({
      text: 'yaml_editor.error_misaligned_dedent_fix:{"line":4,"key":"- pulse","spaces":1}',
      jumpLine: 4,
      fix: { line: 4, indent: -1, key: "pulse" },
    });
  });

  it("names the misaligned-property fix on the property's own line", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    const doc = [
      "output:", // 1
      "   - platform: ledc", // 2
      "     pin: 18", // 3
      "    id: buzzer_output", // 4
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    expect(
      describeYamlError(
        "mapping values are not allowed here",
        { line: 4, col: 5 },
        localize,
        read
      )
    ).toEqual({
      text: 'yaml_editor.error_misaligned_indent_fix:{"line":4,"key":"id","spaces":1}',
      jumpLine: 4,
      fix: { line: 4, indent: 1, key: "id" },
    });
  });

  it("maps the indentation family to the indent hint", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    // Real esphome messages (pyyaml pure-Python loader, which esphome falls
    // back to for readable errors): a stray colon, a block-mapping dedent, and
    // a block-collection mis-indent.
    for (const msg of [
      "mapping values are not allowed here",
      "expected <block end>, but found '<block mapping start>'",
      "could not find expected ':'",
    ]) {
      expect(describeYamlError(msg, pos(5), localize).text).toBe(
        'yaml_editor.error_indent_hint:{"line":5}'
      );
    }
  });

  it("maps a tab error to the tab hint (pyyaml names the char via %r)", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    expect(
      describeYamlError(
        "found character '\\t' that cannot start any token",
        pos(3),
        localize
      ).text
    ).toBe('yaml_editor.error_tab_hint:{"line":3}');
  });

  it("maps a non-tab stray character to the char hint", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    expect(
      describeYamlError(
        "found character '@' that cannot start any token",
        pos(6),
        localize
      ).text
    ).toBe('yaml_editor.error_char_hint:{"line":6}');
  });

  it("maps an unterminated quoted scalar to the unterminated-string hint", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    expect(
      describeYamlError(
        "while scanning a quoted scalar found unexpected end of stream",
        pos(7),
        localize
      ).text
    ).toBe('yaml_editor.error_unterminated_string_hint:{"line":7}');
  });

  it("maps an unclosed flow collection to the flow hint", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    for (const msg of [
      "while parsing a flow sequence\nexpected ',' or ']', but got '<stream end>'",
      "while parsing a flow mapping\nexpected ',' or '}', but got '<stream end>'",
    ]) {
      expect(describeYamlError(msg, pos(2), localize).text).toBe(
        'yaml_editor.error_flow_hint:{"line":2}'
      );
    }
  });

  it("maps a duplicate key to the duplicate-key hint", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    // esphome's own message shape (see yaml_util's ESPHomeLoaderMixin).
    expect(describeYamlError('Duplicate key "wifi"', pos(11), localize).text).toBe(
      'yaml_editor.error_duplicate_key_hint:{"line":11}'
    );
  });

  it("passes an unrecognized message through, sanitized", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    expect(describeYamlError("some other yaml error", pos(4), localize)).toEqual({
      text: "some other yaml error",
      jumpLine: 4,
    });
  });

  it("has no jump line when the message carries no position", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-lint-backend.js");
    expect(
      describeYamlError("mapping values are not allowed here", null, localize)
    ).toEqual({ text: "mapping values are not allowed here", jumpLine: null });
  });
});

describe("getLastValidatedResult", () => {
  it("returns null when nothing has been validated for the configuration", async () => {
    const { getLastValidatedResult } =
      await import("../../src/util/yaml-lint-backend.js");
    expect(getLastValidatedResult("kitchen.yaml", "esphome:\n")).toBeNull();
  });

  it("returns null for a configuration that has no entry yet", async () => {
    const { getLastValidatedResult, __setLastValidatedForTesting } =
      await import("../../src/util/yaml-lint-backend.js");
    const result = { yaml_errors: [], validation_errors: [] };
    __setLastValidatedForTesting("kitchen.yaml", "esphome:\n  name: a\n", result);
    expect(getLastValidatedResult("bedroom.yaml", "esphome:\n  name: a\n")).toBeNull();
  });

  it("returns the cached result when content matches exactly", async () => {
    const { getLastValidatedResult, __setLastValidatedForTesting } =
      await import("../../src/util/yaml-lint-backend.js");
    const result = { yaml_errors: [], validation_errors: [] };
    __setLastValidatedForTesting("kitchen.yaml", "esphome:\n  name: kitchen\n", result);
    expect(getLastValidatedResult("kitchen.yaml", "esphome:\n  name: kitchen\n")).toBe(
      result
    );
  });

  it("returns null when content differs by even one byte", async () => {
    const { getLastValidatedResult, __setLastValidatedForTesting } =
      await import("../../src/util/yaml-lint-backend.js");
    const result = { yaml_errors: [], validation_errors: [] };
    __setLastValidatedForTesting("kitchen.yaml", "esphome:\n  name: kitchen\n", result);
    expect(
      getLastValidatedResult("kitchen.yaml", "esphome:\n  name: kitchen \n")
    ).toBeNull();
  });

  it("returns null when the cached entry is past the TTL window", async () => {
    // Stub ``performance.now`` so the seed lands past the TTL boundary.
    const real = performance.now;
    let fakeNow = 1_000_000;
    vi.spyOn(performance, "now").mockImplementation(() => fakeNow);
    try {
      const { getLastValidatedResult, __setLastValidatedForTesting } =
        await import("../../src/util/yaml-lint-backend.js");
      const result = { yaml_errors: [], validation_errors: [] };
      __setLastValidatedForTesting("kitchen.yaml", "esphome:\n", result);
      fakeNow += 60_001;
      expect(getLastValidatedResult("kitchen.yaml", "esphome:\n")).toBeNull();
    } finally {
      vi.spyOn(performance, "now").mockImplementation(real);
    }
  });
});
