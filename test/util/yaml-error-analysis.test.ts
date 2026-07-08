/**
 * Tests for the shared YAML error-message analysis: position extraction
 * (problem mark = LAST line/col), path sanitizing, indentation-mismatch
 * pinpointing, and the plain-language rewrites both the inline linter and
 * the save-time validation prompt consume.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
});

describe("sanitizeMessage", () => {
  it("collapses a POSIX absolute path to its basename", async () => {
    const { sanitizeMessage } = await import("../../src/util/yaml-error-analysis.js");
    expect(
      sanitizeMessage('in "/Users/bdraco/esphome/foo.yaml", line 17, column 2')
    ).toBe('in "foo.yaml", line 17, column 2');
  });

  it("collapses a Windows absolute path to its basename", async () => {
    const { sanitizeMessage } = await import("../../src/util/yaml-error-analysis.js");
    expect(sanitizeMessage('in "C:\\Users\\bdraco\\esphome\\foo.yaml"')).toBe(
      'in "foo.yaml"'
    );
  });

  it("strips every quoted path and leaves bare filenames untouched", async () => {
    const { sanitizeMessage } = await import("../../src/util/yaml-error-analysis.js");
    expect(
      sanitizeMessage('"/a/b/x.yaml" includes "/c/d/y.yaml" but "z.yaml" stays')
    ).toBe('"x.yaml" includes "y.yaml" but "z.yaml" stays');
  });
});

describe("parseYamlErrorPosition", () => {
  it("returns the last (problem-mark) line/column, not the first", async () => {
    const { parseYamlErrorPosition } =
      await import("../../src/util/yaml-error-analysis.js");
    const msg =
      "while parsing a block mapping in x, line 1, column 1 expected <block end>, " +
      "but found '<scalar>' in x, line 17, column 2";
    expect(parseYamlErrorPosition(msg)).toEqual({ line: 17, col: 2 });
  });

  it("falls back to a bare `line N` with a null column", async () => {
    const { parseYamlErrorPosition } =
      await import("../../src/util/yaml-error-analysis.js");
    expect(
      parseYamlErrorPosition("could not determine a constructor for line 4")
    ).toEqual({
      line: 4,
      col: null,
    });
  });

  it("returns null when the message carries no position", async () => {
    const { parseYamlErrorPosition } =
      await import("../../src/util/yaml-error-analysis.js");
    expect(parseYamlErrorPosition("mapping values are not allowed here")).toBeNull();
  });
});

describe("describeNestedListValue", () => {
  const localize = (key: string, values?: Record<string, string | number>): string =>
    values ? `${key}:${JSON.stringify(values)}` : key;

  it("names the nested-list misindent behind 'expected a dictionary.'", async () => {
    const { describeNestedListValue } =
      await import("../../src/util/yaml-error-analysis.js");
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
      await import("../../src/util/yaml-error-analysis.js");
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
      await import("../../src/util/yaml-error-analysis.js");
    const doc = (n: number): string | undefined => ["logger:", "  le"][n - 1];
    expect(describeValueTypeCause(doc, 2, localize)).toEqual({
      text: 'yaml_editor.error_missing_colon_hint:{"line":2,"key":"le"}',
    });
    const keyed = (n: number): string | undefined => ["logger:", "  level: DEBUG"][n - 1];
    expect(describeValueTypeCause(keyed, 2, localize)).toBeNull();
  });

  // The valid-YAML variant of the stuck dash: `-platform:` with no deeper
  // lines parses as a mapping key, so the section fails schema validation
  // and the cause carries the dash-space repair.
  it("names the stuck dash behind a schema error and carries its repair", async () => {
    const { describeValueTypeCause } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = (n: number): string | undefined =>
      ["ota:", "  -platform: esphome"][n - 1];
    expect(describeValueTypeCause(doc, 2, localize)).toEqual({
      text: 'yaml_editor.error_dash_space_fix:{"line":2,"key":"platform"}',
      fix: { line: 2, indent: 0, key: "-platform", fromIndent: 2, kind: "dash-space" },
    });
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
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    expect(analyzeIndentMismatch(readLine, 3)).toEqual({
      markerLine: 2,
      markerKey: "platform",
      delta: 2,
      reason: "props-below",
    });
  });

  it("returns null when the item and its properties already line up", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const ok = (n: number): string | undefined =>
      ["sensor:", "  - platform: dht", "    model: DHT11"][n - 1];
    expect(analyzeIndentMismatch(ok, 3)).toBeNull();
  });

  it("returns null when no list-item marker precedes the error line", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const plain = (n: number): string | undefined =>
      ["esphome:", "  name: x", "  bogus: y"][n - 1];
    expect(analyzeIndentMismatch(plain, 3)).toBeNull();
  });

  // The mirror shape: the marker itself dedented out of its list, which the
  // scanner blames directly ("expected <block end>, but found '-'").
  it("pinpoints an under-indented marker from the properties below it", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
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
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const bare = (n: number): string | undefined =>
      ["time:", "- platform: sntp", "sensor:"][n - 1];
    expect(analyzeIndentMismatch(bare, 2)).toBeNull();
  });

  it("returns null for a blamed marker whose properties already line up", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const aligned = (n: number): string | undefined =>
      ["time:", "- platform: sntp", "  id: sntp_time"][n - 1];
    expect(analyzeIndentMismatch(aligned, 2)).toBeNull();
  });

  // Sibling alignment: a marker one space off from the marker above it, in
  // either direction ("expected <block end>, but found '<block sequence
  // start>'" blames the odd marker directly).
  it("dedents a blamed marker sitting deeper than the marker above it", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
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
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
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
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
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
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
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
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
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
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
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

  // Continuation shape: the blamed line sits deeper than the valued pair
  // above it, so the scanner reads it as that value's plain-scalar
  // continuation ("mapping values are not allowed here").
  it("re-indents a valued pair dedented out of the value-less block above it", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = (n: number): string | undefined =>
      [
        "    pin:", // 1
        "      inverted: true", // 2
        "      mode:", // 3
        "      input: true", // 4
        "        pullup: true", // 5
        "      number: 9", // 6
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 5)).toEqual({
      markerLine: 4,
      markerKey: "input",
      delta: 2,
      reason: "align",
    });
  });

  it("dedents a blamed line sitting deeper than the valued pair above it", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = (n: number): string | undefined =>
      [
        "    pin:", // 1
        "      inverted: true", // 2
        "        pullup: true", // 3
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 3)).toEqual({
      markerLine: 3,
      markerKey: "pullup",
      delta: -2,
      reason: "align",
    });
  });

  it("won't guess the continuation repair beyond a few spaces", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = (n: number): string | undefined =>
      [
        "      mode:", // 1
        "      input: true", // 2
        "            pullup: true", // 3
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 3)).toBeNull();
  });

  // Dedented block opener: `mode:` dropped to the item-property level while
  // its children stay deep; the scanner blames the block-close line
  // (`number:`), but the aligned sibling above (`inverted:`) proves the
  // value-less key is what moved.
  it("re-indents a dedented value-less key blamed on its block-close line", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = (n: number): string | undefined =>
      [
        "binary_sensor:", // 1
        "  - platform: gpio", // 2
        "    name: Boot Button", // 3
        "    pin:", // 4
        "      inverted: true", // 5
        "    mode:", // 6
        "        input: true", // 7
        "        pullup: true", // 8
        "      number: 9", // 9
        "    id: boot_button", // 10
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 9)).toEqual({
      markerLine: 6,
      markerKey: "mode",
      delta: 2,
      reason: "align",
    });
  });

  // The mirror: the opener sits where it belongs (a sibling shares its
  // indent, the blamed line is at its canonical child indent) and the
  // block's first child is what went too deep.
  it("dedents an over-deep first child blamed on the opener's next child", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = (n: number): string | undefined =>
      [
        "binary_sensor:", // 1
        "  - platform: gpio", // 2
        "    name: Button Module", // 3
        "    pin:", // 4
        "      inverted: true", // 5
        "      mode:", // 6
        "          input: true", // 7
        "        pullup: true", // 8
        "      number: 6", // 9
        "    id: button_module", // 10
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 8)).toEqual({
      markerLine: 7,
      markerKey: "input",
      delta: -2,
      reason: "align",
    });
  });

  // The same reading under a TOP-LEVEL opener: `wifi:`'s first child went
  // too deep. The `name:` line above `wifi:` belongs to the previous
  // section and must not re-indent the top-level key.
  it("dedents an over-deep first child under a top-level opener", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = (n: number): string | undefined =>
      [
        "esphome:", // 1
        "  name: newstk", // 2
        "", // 3
        "wifi:", // 4
        "  ", // 5
        "    ssid: mynet", // 6
        "  password: mypass", // 7
        "  ap:", // 8
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 7)).toEqual({
      markerLine: 6,
      markerKey: "ssid",
      delta: -2,
      reason: "align",
    });
  });

  // A childless section head nudged just off column 0, with only plain
  // mappings above it (no marker context).
  it("dedents a childless section head nudged off the margin", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = (n: number): string | undefined =>
      [
        "wifi:", // 1
        "  ssid: mynet", // 2
        "  ap:", // 3
        "    ssid: fallback", // 4
        "", // 5
        " captive_portal:", // 6
        "", // 7
        "switch:", // 8
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 6)).toEqual({
      markerLine: 6,
      markerKey: "captive_portal",
      delta: -1,
      reason: "align",
    });
  });

  it("won't dedent a nudged key that opens a deeper block", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    // ` ap:` at 1 with children at 4 could as well belong at 2 inside
    // `wifi:` — ambiguous, so no confident repair.
    const doc = (n: number): string | undefined =>
      [
        "wifi:", // 1
        "  ssid: mynet", // 2
        " ap:", // 3
        "    ssid: fallback", // 4
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 3)).toBeNull();
  });

  // An over-indented property whose FOLLOWING siblings sit at the content
  // column: the marker aligns with its list, so the blamed line moved.
  it("dedents an over-indented property when the properties below line up", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = (n: number): string | undefined =>
      [
        "binary_sensor:", // 1
        "  - platform: gpio", // 2
        "     name: Button Module", // 3
        "    pin:", // 4
        "      inverted: true", // 5
        "    id: button_module", // 6
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 3)).toEqual({
      markerLine: 3,
      markerKey: "name",
      delta: -1,
      reason: "align",
    });
  });

  it("re-indents a property dedented to its list's marker indent", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = (n: number): string | undefined =>
      [
        "binary_sensor:", // 1
        "  - platform: gpio", // 2
        "    name: Motion Module", // 3
        "    pin: 3", // 4
        "  device_class: motion", // 5
        "    id: motion_module", // 6
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 5)).toEqual({
      markerLine: 5,
      markerKey: "device_class",
      delta: 2,
      reason: "align",
    });
  });

  // A section head nudged off its level: the key sits strictly between the
  // list's parent level and its markers, closing the list at a level
  // nothing occupies.
  it("dedents a section head sitting between the parent level and the markers", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = (n: number): string | undefined =>
      [
        "rtttl:", // 1
        "  - output: buzzer_output", // 2
        "    id: rtttl_player", // 3
        "", // 4
        " i2c:", // 5
        "  - scl: 0", // 6
        "    sda: 1", // 7
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 5)).toEqual({
      markerLine: 5,
      markerKey: "i2c",
      delta: -1,
      reason: "align",
    });
  });

  it("won't claim a shallow key when the parent level isn't adjacent", async () => {
    const { analyzeIndentMismatch } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = (n: number): string | undefined =>
      [
        "    effects:", // 1
        "      - addressable_twinkle:", // 2
        "      - flicker:", // 3
        " i2c:", // 4
      ][n - 1];
    expect(analyzeIndentMismatch(doc, 4)).toBeNull();
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
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
    expect(
      describeYamlError("mapping values are not allowed here", pos(3), localize, readDht)
    ).toEqual({
      text: 'yaml_editor.error_indent_fix:{"line":2,"key":"platform","spaces":2}',
      jumpLine: 2,
      fix: { line: 2, indent: 2, key: "platform", fromIndent: 0 },
    });
  });

  it("falls back to the generic indentation hint (no auto-fix) when it can't pinpoint", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
    // No readLine, so no document to analyze.
    expect(
      describeYamlError("mapping values are not allowed here", pos(9), localize)
    ).toEqual({ text: 'yaml_editor.error_indent_hint:{"line":9}', jumpLine: 9 });
  });

  it("falls back to the generic hint (no auto-fix) when the document has no mismatch", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
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
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
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
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
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
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
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
      fix: { line: 4, indent: -1, key: "pulse", fromIndent: 7 },
    });
  });

  it("names the misaligned-property fix on the property's own line", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
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
      fix: { line: 4, indent: 1, key: "id", fromIndent: 4 },
    });
  });

  // Real PyYAML shape for a pair dedented out of its block: the scanner
  // blames the ':' on the deeper line below the pair, not the pair itself.
  it("re-indents the dedented pair from a mapping-values message", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
    const doc = [
      "    pin:", // 1
      "      inverted: true", // 2
      "      mode:", // 3
      "      input: true", // 4
      "        pullup: true", // 5
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    expect(
      describeYamlError(
        'mapping values are not allowed here\n  in "x.yaml", line 5, column 15',
        { line: 5, col: 15 },
        localize,
        read
      )
    ).toEqual({
      text: 'yaml_editor.error_misaligned_indent_fix:{"line":4,"key":"input","spaces":2}',
      jumpLine: 4,
      fix: { line: 4, indent: 2, key: "input", fromIndent: 6 },
    });
  });

  // Real PyYAML shape for a dedented value-less key: the problem mark blames
  // the line that closes the key's too-deep block, lines below the key.
  it("re-indents the dedented block opener from a block-mapping message", async () => {
    const { describeYamlError, parseYamlErrorPosition } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = [
      "binary_sensor:", // 1
      "  - platform: gpio", // 2
      "    name: Boot Button", // 3
      "    pin:", // 4
      "      inverted: true", // 5
      "    mode:", // 6
      "        input: true", // 7
      "        pullup: true", // 8
      "      number: 9", // 9
      "    id: boot_button", // 10
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    const msg =
      "while parsing a block mapping\n" +
      '  in "x.yaml", line 2, column 5\n' +
      "expected <block end>, but found '<block mapping start>'\n" +
      '  in "x.yaml", line 9, column 7';
    expect(describeYamlError(msg, parseYamlErrorPosition(msg), localize, read)).toEqual({
      text: 'yaml_editor.error_misaligned_indent_fix:{"line":6,"key":"mode","spaces":2}',
      jumpLine: 6,
      fix: { line: 6, indent: 2, key: "mode", fromIndent: 4 },
    });
  });

  // Real PyYAML shape for an over-deep first child: the problem mark blames
  // the opener's next child, which no longer fits the too-deep block.
  it("dedents the over-deep first child from a block-mapping message", async () => {
    const { describeYamlError, parseYamlErrorPosition } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = [
      "binary_sensor:", // 1
      "  - platform: gpio", // 2
      "    name: Button Module", // 3
      "    pin:", // 4
      "      inverted: true", // 5
      "      mode:", // 6
      "          input: true", // 7
      "        pullup: true", // 8
      "      number: 6", // 9
      "    id: button_module", // 10
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    const msg =
      "while parsing a block mapping\n" +
      '  in "x.yaml", line 5, column 7\n' +
      "expected <block end>, but found '<block mapping start>'\n" +
      '  in "x.yaml", line 8, column 9';
    expect(describeYamlError(msg, parseYamlErrorPosition(msg), localize, read)).toEqual({
      text: 'yaml_editor.error_misaligned_dedent_fix:{"line":7,"key":"input","spaces":2}',
      jumpLine: 7,
      fix: { line: 7, indent: -2, key: "input", fromIndent: 10 },
    });
  });

  // Real PyYAML shape for an over-deep first child under a TOP-LEVEL key:
  // the problem mark blames the next child that no longer fits.
  it("dedents the over-deep first child of a top-level key from its message", async () => {
    const { describeYamlError, parseYamlErrorPosition } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = [
      "esphome:", // 1
      "  name: newstk", // 2
      "", // 3
      "wifi:", // 4
      "  ", // 5
      "    ssid: mynet", // 6
      "  password: mypass", // 7
      "  ap:", // 8
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    const msg =
      "while parsing a block mapping\n" +
      '  in "x.yaml", line 1, column 1\n' +
      "expected <block end>, but found '<block mapping start>'\n" +
      '  in "x.yaml", line 7, column 3';
    expect(describeYamlError(msg, parseYamlErrorPosition(msg), localize, read)).toEqual({
      text: 'yaml_editor.error_misaligned_dedent_fix:{"line":6,"key":"ssid","spaces":2}',
      jumpLine: 6,
      fix: { line: 6, indent: -2, key: "ssid", fromIndent: 4 },
    });
  });

  // Real PyYAML shape for a childless section head nudged off column 0
  // with no marker context above it.
  it("dedents the nudged section head with no marker context from its message", async () => {
    const { describeYamlError, parseYamlErrorPosition } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = [
      "wifi:", // 1
      "  ssid: mynet", // 2
      "  ap:", // 3
      "    ssid: fallback", // 4
      "", // 5
      " captive_portal:", // 6
      "", // 7
      "switch:", // 8
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    const msg =
      "while parsing a block mapping\n" +
      '  in "x.yaml", line 1, column 1\n' +
      "expected <block end>, but found '<block mapping start>'\n" +
      '  in "x.yaml", line 6, column 2';
    expect(describeYamlError(msg, parseYamlErrorPosition(msg), localize, read)).toEqual({
      text: 'yaml_editor.error_misaligned_dedent_fix:{"line":6,"key":"captive_portal","spaces":1}',
      jumpLine: 6,
      fix: { line: 6, indent: -1, key: "captive_portal", fromIndent: 1 },
    });
  });

  // Real PyYAML shape for an over-indented property directly after its
  // marker: the scanner reads it as a continuation of the marker's value.
  it("dedents the over-indented first property from a mapping-values message", async () => {
    const { describeYamlError, parseYamlErrorPosition } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = [
      "binary_sensor:", // 1
      "  - platform: gpio", // 2
      "     name: Button Module", // 3
      "    pin:", // 4
      "      inverted: true", // 5
      "    id: button_module", // 6
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    const msg = 'mapping values are not allowed here\n  in "x.yaml", line 3, column 10';
    expect(describeYamlError(msg, parseYamlErrorPosition(msg), localize, read)).toEqual({
      text: 'yaml_editor.error_misaligned_dedent_fix:{"line":3,"key":"name","spaces":1}',
      jumpLine: 3,
      fix: { line: 3, indent: -1, key: "name", fromIndent: 5 },
    });
  });

  // A dash stuck to its key: the scanner reads `-platform: gpio` as a
  // `-platform` mapping key and blames the deeper line below it.
  it("offers the dash-space fix when the line above the blame is a stuck dash", async () => {
    const { describeYamlError, parseYamlErrorPosition } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = [
      "switch:", // 1
      "  -platform: gpio", // 2
      "    id: accessory_power", // 3
      "    internal: true", // 4
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    const msg = 'mapping values are not allowed here\n  in "x.yaml", line 3, column 7';
    expect(describeYamlError(msg, parseYamlErrorPosition(msg), localize, read)).toEqual({
      text: 'yaml_editor.error_dash_space_fix:{"line":2,"key":"platform"}',
      jumpLine: 2,
      squiggleLine: 2,
      fix: { line: 2, indent: 0, key: "-platform", fromIndent: 2, kind: "dash-space" },
    });
  });

  // The same typo mixed into a real list gets blamed on its own line.
  it("offers the dash-space fix when the blamed line itself is a stuck dash", async () => {
    const { describeYamlError, parseYamlErrorPosition } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = [
      "light:", // 1
      "  - platform: x", // 2
      "  -platform: y", // 3
      "    id: z", // 4
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    const msg =
      "while parsing a block collection\n" +
      '  in "x.yaml", line 2, column 3\n' +
      "expected <block end>, but found '?'\n" +
      '  in "x.yaml", line 3, column 3';
    expect(describeYamlError(msg, parseYamlErrorPosition(msg), localize, read)).toEqual({
      text: 'yaml_editor.error_dash_space_fix:{"line":3,"key":"platform"}',
      jumpLine: 3,
      squiggleLine: 3,
      fix: { line: 3, indent: 0, key: "-platform", fromIndent: 2, kind: "dash-space" },
    });
  });

  // Real PyYAML shape for a section head nudged off its level: the problem
  // mark blames the key line itself, one space into the closed list.
  it("dedents the nudged section head from a block-mapping message", async () => {
    const { describeYamlError, parseYamlErrorPosition } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = [
      "rtttl:", // 1
      "  - output: buzzer_output", // 2
      "    id: rtttl_player", // 3
      "", // 4
      " i2c:", // 5
      "  - scl: 0", // 6
      "    sda: 1", // 7
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    const msg =
      "while parsing a block mapping\n" +
      '  in "x.yaml", line 1, column 1\n' +
      "expected <block end>, but found '<block mapping start>'\n" +
      '  in "x.yaml", line 5, column 2';
    expect(describeYamlError(msg, parseYamlErrorPosition(msg), localize, read)).toEqual({
      text: 'yaml_editor.error_misaligned_dedent_fix:{"line":5,"key":"i2c","spaces":1}',
      jumpLine: 5,
      fix: { line: 5, indent: -1, key: "i2c", fromIndent: 1 },
    });
  });

  // Real PyYAML shape for a property dedented to the markers' own indent:
  // the problem mark (last position) blames the property line itself.
  it("re-indents the marker-indent property from a block-collection message", async () => {
    const { describeYamlError, parseYamlErrorPosition } =
      await import("../../src/util/yaml-error-analysis.js");
    const doc = [
      "binary_sensor:", // 1
      "  - platform: gpio", // 2
      "    name: Motion Module", // 3
      "    pin: 3", // 4
      "  device_class: motion", // 5
      "    id: motion_module", // 6
    ];
    const read = (n: number): string | undefined => doc[n - 1];
    const msg =
      "while parsing a block collection\n" +
      '  in "x.yaml", line 2, column 3\n' +
      "expected <block end>, but found '?'\n" +
      '  in "x.yaml", line 5, column 3';
    expect(describeYamlError(msg, parseYamlErrorPosition(msg), localize, read)).toEqual({
      text: 'yaml_editor.error_misaligned_indent_fix:{"line":5,"key":"device_class","spaces":2}',
      jumpLine: 5,
      fix: { line: 5, indent: 2, key: "device_class", fromIndent: 2 },
    });
  });

  it("maps the indentation family to the indent hint", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
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
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
    expect(
      describeYamlError(
        "found character '\\t' that cannot start any token",
        pos(3),
        localize
      ).text
    ).toBe('yaml_editor.error_tab_hint:{"line":3}');
  });

  it("maps a non-tab stray character to the char hint", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
    expect(
      describeYamlError(
        "found character '@' that cannot start any token",
        pos(6),
        localize
      ).text
    ).toBe('yaml_editor.error_char_hint:{"line":6}');
  });

  it("maps an unterminated quoted scalar to the unterminated-string hint", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
    expect(
      describeYamlError(
        "while scanning a quoted scalar found unexpected end of stream",
        pos(7),
        localize
      ).text
    ).toBe('yaml_editor.error_unterminated_string_hint:{"line":7}');
  });

  it("maps an unclosed flow collection to the flow hint", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
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
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
    // esphome's own message shape (see yaml_util's ESPHomeLoaderMixin).
    expect(describeYamlError('Duplicate key "wifi"', pos(11), localize).text).toBe(
      'yaml_editor.error_duplicate_key_hint:{"line":11}'
    );
  });

  it("passes an unrecognized message through, sanitized", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
    expect(describeYamlError("some other yaml error", pos(4), localize)).toEqual({
      text: "some other yaml error",
      jumpLine: 4,
    });
  });

  it("has no jump line when the message carries no position", async () => {
    const { describeYamlError } = await import("../../src/util/yaml-error-analysis.js");
    expect(
      describeYamlError("mapping values are not allowed here", null, localize)
    ).toEqual({ text: "mapping values are not allowed here", jumpLine: null });
  });
});
