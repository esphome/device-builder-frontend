import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  blankLineContext,
  collectSiblingKeysByIndent,
  fieldPathByIndent,
  findParentKey,
  findTopLevelBlock,
  indentOf,
  keyPathByIndent,
  readPlatformSibling,
  stripComment,
  unquote,
} from "../../src/util/yaml-line-walker.js";

/** Build a CodeMirror `Text` doc from an array of lines. */
const t = (lines: string[]) => Text.of(lines);

describe("indentOf", () => {
  it("counts leading spaces", () => {
    expect(indentOf("   foo")).toBe(3);
    expect(indentOf("foo")).toBe(0);
    expect(indentOf("")).toBe(0);
  });

  it("does NOT count tabs (YAML insists on spaces)", () => {
    expect(indentOf("\t  foo")).toBe(0);
  });
});

describe("stripComment", () => {
  it("strips ' # ' inline comments", () => {
    expect(stripComment("name: foo  # comment here")).toBe("name: foo");
  });

  it("preserves '#' embedded in a scalar with no preceding space", () => {
    // ``RE_INLINE_COMMENT_BOUNDARY`` requires either start-of-line
    // or whitespace before the ``#`` — a ``#`` glued to the
    // previous token (e.g. ``foo#bar``) is part of the scalar.
    expect(stripComment("name:foo#bar")).toBe("name:foo#bar");
  });

  it("strips a comment that starts at column 0", () => {
    expect(stripComment("# whole-line comment")).toBe("");
  });

  it("trims trailing whitespace when there's no comment", () => {
    expect(stripComment("name: foo   ")).toBe("name: foo");
  });
});

describe("unquote", () => {
  it("strips one layer of matched double quotes", () => {
    expect(unquote('"gpio"')).toBe("gpio");
  });

  it("strips one layer of matched single quotes", () => {
    expect(unquote("'gpio'")).toBe("gpio");
  });

  it("leaves an unquoted value untouched", () => {
    expect(unquote("gpio")).toBe("gpio");
  });

  it("leaves mismatched quotes untouched", () => {
    expect(unquote("\"gpio'")).toBe("\"gpio'");
  });

  it("leaves a lone quote character untouched", () => {
    expect(unquote('"')).toBe('"');
  });

  it("strips only the outer layer of nested quotes", () => {
    expect(unquote("'\"gpio\"'")).toBe('"gpio"');
  });

  it("does not decode the YAML '' single-quote escape (unlike stripQuotes)", () => {
    // Pins the invariant that keeps this helper separate from
    // yaml-scalar's stripQuotes: swapping in scalar-style parsing
    // would silently change hover/walker behavior.
    expect(unquote("'it''s'")).toBe("it''s");
  });
});

describe("findParentKey", () => {
  const lines = [
    "esphome:", //                     0
    "  name: test", //                 1
    "binary_sensor:", //               2
    "  - platform: gpio", //           3
    "    id: button", //               4
    "    name: Foo", //                5
    "    o", //                        6 — cursor here at indent 4
  ];

  it("finds the nearest ancestor key strictly less indented", () => {
    // From line 6 (indent 4) → walks up → ``- platform: gpio`` at
    // indent 2, regex captures ``platform``.
    expect(findParentKey(t(lines), 6, 4)).toEqual({
      key: "platform",
      indent: 2,
      lineIdx: 3,
    });
  });

  it("returns null when there's no shallower key", () => {
    expect(findParentKey(t(lines), 0, 0)).toBeNull();
  });

  it("skips blank and comment-only lines", () => {
    const noisy = ["wifi:", "", "  # hi", "  ssid: x"];
    expect(findParentKey(t(noisy), 3, 2)).toEqual({
      key: "wifi",
      indent: 0,
      lineIdx: 0,
    });
  });
});

describe("findTopLevelBlock", () => {
  const lines = [
    "esphome:", //                     0
    "  name: test", //                 1
    "wifi:", //                        2
    "  ssid: x", //                    3 — ancestor: wifi
  ];

  it("returns the most recent column-0 key above the cursor", () => {
    expect(findTopLevelBlock(t(lines), 3)).toBe("wifi");
    expect(findTopLevelBlock(t(lines), 1)).toBe("esphome");
  });

  it("returns null when the cursor is the top of the doc", () => {
    expect(findTopLevelBlock(t(lines), 0)).toBeNull();
  });
});

describe("readPlatformSibling (regex fallback)", () => {
  // The AST-based ``resolveBundleContext`` (in ``yaml-ast.ts``) is
  // the authoritative resolver, but at value-position cursors on
  // a half-typed pair (``device_class:`` with no value yet) Lezer
  // hasn't finished the Pair so ``getTopLevelKey`` returns null
  // and the regex walker is the only path that can answer. Pin
  // the dash-column case so a future regex change can't drop it.

  it("reads ``- platform: <value>`` even when the dash is at a shallower indent", () => {
    // ``- platform: template`` puts the dash at indent 2 and the
    // body keys at indent 4. The walker now recognises the dash
    // line as the enclosing list-item header and parses its
    // ``platform:`` value directly instead of breaking on
    // ``ind < cursorIndent``.
    const lines = ["binary_sensor:", "  - platform: template", "    name: hi"];
    expect(readPlatformSibling(t(lines), 2, 4)).toBe("template");
  });

  it("reads platform sibling for a deeply-nested cursor (``device_class:`` user-reported case)", () => {
    // User scenario: cursor sitting at ``device_class: `` (no
    // value yet). Lezer hasn't finished the pair, so the AST is
    // silent — the regex walker has to resolve the platform
    // sibling for the schema-bundle enum-value lookup.
    const lines = [
      "sensor:",
      "  - platform: uptime",
      "    name: zwave",
      "    device_class: ",
    ];
    expect(readPlatformSibling(t(lines), 3, 4)).toBe("uptime");
  });

  it("walks past intermediate keys to find a platform several levels up", () => {
    // User-reported: cursor sits at a list-item position under
    // ``filters:`` (deeply nested under the outer
    // ``- platform: uptime`` sensor item). The immediate
    // ancestor at parent.key is ``filters``, not ``platform``,
    // so the same-indent walker can't find the platform. Walk
    // back-and-up looking for any ``- platform: <value>`` line
    // at a shallower indent than the cursor. AST is silent here
    // because the trailing ``      - `` is a half-typed Item
    // Lezer hasn't completed yet.
    const lines = [
      "sensor:",
      "  - platform: uptime",
      "    name: zwave",
      "    filters:",
      "      - ",
    ];
    expect(readPlatformSibling(t(lines), 4, 6)).toBe("uptime");
  });

  it("strips quotes from quoted platform values", () => {
    // Schema-host JSON uses bare names, but configs in the wild
    // commonly quote platforms (``platform: "dht"``). The regex
    // walker has to accept both forms and return the unquoted
    // string so the schema-bundle lookup succeeds.
    const dq = ["sensor:", '  - platform: "dht"', "    pin: 5"];
    expect(readPlatformSibling(t(dq), 2, 4)).toBe("dht");
    const sq = ["sensor:", "  - platform: 'dht'", "    pin: 5"];
    expect(readPlatformSibling(t(sq), 2, 4)).toBe("dht");
  });

  it("returns null when there's no platform sibling", () => {
    const lines = ["wifi:", "  ssid: x", "  password: y"];
    expect(readPlatformSibling(t(lines), 2, 2)).toBeNull();
  });
});

describe("keyPathByIndent", () => {
  it("builds the full ancestor chain for a blank nested line", () => {
    const lines = ["esp32:", "  framework:", "    type: esp-idf", "    "];
    expect(keyPathByIndent(t(lines), 3, 4)).toEqual(["esp32", "framework"]);
  });

  it("descends two nested levels", () => {
    const lines = ["esp32:", "  framework:", "    advanced:", "      "];
    expect(keyPathByIndent(t(lines), 3, 6)).toEqual(["esp32", "framework", "advanced"]);
  });

  it("returns [] at the top level", () => {
    const lines = ["esp32:", "  board: x", ""];
    expect(keyPathByIndent(t(lines), 2, 0)).toEqual([]);
  });

  it("skips blank lines between siblings", () => {
    const lines = ["esp32:", "  framework:", "", "    type: a", "    "];
    expect(keyPathByIndent(t(lines), 4, 4)).toEqual(["esp32", "framework"]);
  });
});

describe("collectSiblingKeysByIndent", () => {
  it("collects the mapping's keys at the cursor indent", () => {
    const lines = ["ethernet:", "  clk:", "    mode: CLK_EXT_IN", "    pin: 0", "    "];
    expect([...collectSiblingKeysByIndent(t(lines), 4, 4)].sort()).toEqual([
      "mode",
      "pin",
    ]);
  });

  it("skips deeper descendants and other blocks", () => {
    const lines = [
      "esp32:",
      "  framework:",
      "    advanced:",
      "      x: 1",
      "    version: 5",
      "    ",
    ];
    expect([...collectSiblingKeysByIndent(t(lines), 5, 4)].sort()).toEqual([
      "advanced",
      "version",
    ]);
  });
});

describe("fieldPathByIndent", () => {
  it("resolves a flat list-item field, skipping the anonymous dash key", () => {
    // keyPathByIndent would wrongly include `platform` from the dash line; the
    // field path treats the list item as anonymous and yields just the parent.
    const lines = [
      "sensor:",
      "  - platform: template",
      "    state_class: measurement",
      "    device_class:",
    ];
    expect(fieldPathByIndent(t(lines), 3)).toEqual(["sensor", "device_class"]);
  });

  it("keeps an empty-value dash container key (action args), drops inline ones", () => {
    // `- logger.log:` is a container (its args nest under it) so its key stays
    // in the path; `- platform: gpio` is an inline item whose key is a sibling
    // field and is dropped — matching what getKeyPath yields.
    const lines = [
      "binary_sensor:",
      "  - platform: gpio",
      "    on_press:",
      "      then:",
      "        - logger.log:",
      "            format:",
    ];
    expect(fieldPathByIndent(t(lines), 5)).toEqual([
      "binary_sensor",
      "on_press",
      "then",
      "logger.log",
      "format",
    ]);
  });

  it("resolves a nested map field through named containers", () => {
    const lines = ["esp32:", "  framework:", "    advanced:", "      x:"];
    expect(fieldPathByIndent(t(lines), 3)).toEqual([
      "esp32",
      "framework",
      "advanced",
      "x",
    ]);
  });

  it("resolves a top-level empty-value field", () => {
    expect(fieldPathByIndent(t(["esphome:", "  name: x", "http_request:"]), 2)).toEqual([
      "http_request",
    ]);
  });

  it("returns null on a valued pair, a blank line, and a comment", () => {
    const lines = ["sensor:", "  - platform: template", "    name: x", "", "# c"];
    expect(fieldPathByIndent(t(lines), 2)).toBeNull(); // name: x has a value
    expect(fieldPathByIndent(t(lines), 1)).toBeNull(); // dash line with a value
    expect(fieldPathByIndent(t(lines), 3)).toBeNull(); // blank
    expect(fieldPathByIndent(t(lines), 4)).toBeNull(); // comment-only
  });
});

describe("blankLineContext", () => {
  it("reports a blank indented line, else null", () => {
    const blank = t(["esp32:", "  framework:", "    "]);
    expect(blankLineContext(blank, blank.length)).toEqual({ lineIdx: 2, indent: 4 });
    const filled = t(["esp32:", "  board: x"]);
    expect(blankLineContext(filled, filled.length)).toBeNull();
  });

  it("returns null for a caret in the indentation of a non-blank line", () => {
    // Whole-line check: a caret at column 2 of ``  board: x`` is not a blank
    // line, even though the text before the caret is whitespace.
    const doc = t(["esp32:", "  board: x"]);
    const line2 = doc.line(2);
    expect(blankLineContext(doc, line2.from + 2)).toBeNull();
  });
});
