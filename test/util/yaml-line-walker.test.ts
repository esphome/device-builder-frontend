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
  // the authoritative resolver — these tests pin the regex
  // walker's known limitations so a future change documents the
  // gap clearly.

  it("returns null for the list-item-header dash-column quirk", () => {
    // ``- platform: template`` puts the dash at indent 2 and the
    // body keys at indent 4. ``indentOf`` only counts leading
    // spaces, so the dash line registers as indent 2. The walker
    // breaks early when ind < cursor's indent (4). This is the
    // exact case the AST exists to handle.
    const lines = [
      "binary_sensor:",
      "  - platform: template",
      "    name: hi",
    ];
    expect(readPlatformSibling(lines, 2, 4)).toBeNull();
  });

  it("returns null when there's no platform sibling", () => {
    const lines = ["wifi:", "  ssid: x", "  password: y"];
    expect(readPlatformSibling(lines, 2, 2)).toBeNull();
  });
});
