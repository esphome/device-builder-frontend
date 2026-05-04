import { describe, expect, it } from "vitest";
import {
  findParentKey,
  findTopLevelBlock,
  indentOf,
  readPlatformSibling,
  stripComment,
} from "../../src/util/yaml-line-walker.js";

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
    expect(findParentKey(lines, 6, 4)).toEqual({
      key: "platform",
      indent: 2,
      lineIdx: 3,
    });
  });

  it("returns null when there's no shallower key", () => {
    expect(findParentKey(lines, 0, 0)).toBeNull();
  });

  it("skips blank and comment-only lines", () => {
    const noisy = ["wifi:", "", "  # hi", "  ssid: x"];
    expect(findParentKey(noisy, 3, 2)).toEqual({
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
    expect(findTopLevelBlock(lines, 3)).toBe("wifi");
    expect(findTopLevelBlock(lines, 1)).toBe("esphome");
  });

  it("returns null when the cursor is the top of the doc", () => {
    expect(findTopLevelBlock(lines, 0)).toBeNull();
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
    const lines = [
      "binary_sensor:",
      "  - platform: template",
      "    name: hi",
    ];
    expect(readPlatformSibling(lines, 2, 4)).toBe("template");
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
    expect(readPlatformSibling(lines, 3, 4)).toBe("uptime");
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
    expect(readPlatformSibling(lines, 4, 6)).toBe("uptime");
  });

  it("strips quotes from quoted platform values", () => {
    // Schema-host JSON uses bare names, but configs in the wild
    // commonly quote platforms (``platform: "dht"``). The regex
    // walker has to accept both forms and return the unquoted
    // string so the schema-bundle lookup succeeds.
    const dq = ["sensor:", '  - platform: "dht"', "    pin: 5"];
    expect(readPlatformSibling(dq, 2, 4)).toBe("dht");
    const sq = ["sensor:", "  - platform: 'dht'", "    pin: 5"];
    expect(readPlatformSibling(sq, 2, 4)).toBe("dht");
  });

  it("returns null when there's no platform sibling", () => {
    const lines = ["wifi:", "  ssid: x", "  password: y"];
    expect(readPlatformSibling(lines, 2, 2)).toBeNull();
  });
});
