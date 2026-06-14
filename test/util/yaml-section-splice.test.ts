import { describe, expect, it } from "vitest";
import {
  buildSplicedBody,
  yamlValueEqual,
  type ParsedSection,
} from "../../src/util/yaml-section-splice.js";
import { YamlRawValue } from "../../src/util/yaml-serialize.js";

// `yamlValueEqual` is the gate that decides whether a key's source lines
// are copied back byte-for-byte (equal) or re-serialized (changed). The
// asymmetry matters: a false "equal" silently drops a user's edit, a
// false "changed" reformats an untouched key. The cases below pin the
// shapes the section parser actually emits — primitives, null-prototype
// mappings, arrays, and `YamlRawValue` block bodies.
describe("yamlValueEqual", () => {
  it("treats identical primitives as equal", () => {
    expect(yamlValueEqual(1, 1)).toBe(true);
    expect(yamlValueEqual("a", "a")).toBe(true);
    expect(yamlValueEqual(true, true)).toBe(true);
    expect(yamlValueEqual(null, null)).toBe(true);
  });

  it("distinguishes differing primitives and cross-type look-alikes", () => {
    expect(yamlValueEqual(1, 2)).toBe(false);
    expect(yamlValueEqual("a", "b")).toBe(false);
    // 1 and "1" serialize differently; structural equality must not
    // coerce them together or a numeric edit to a string field is lost.
    expect(yamlValueEqual(1, "1")).toBe(false);
    expect(yamlValueEqual(null, undefined)).toBe(false);
    expect(yamlValueEqual(null, {})).toBe(false);
  });

  it("compares arrays element-wise and rejects length / type mismatch", () => {
    expect(yamlValueEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(yamlValueEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(yamlValueEqual([1, 2], "1,2")).toBe(false);
    expect(yamlValueEqual([[1], [2]], [[1], [2]])).toBe(true);
    expect(yamlValueEqual([[1], [2]], [[1], [9]])).toBe(false);
  });

  it("compares plain objects by key set and value", () => {
    expect(yamlValueEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(yamlValueEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    // Same key count, different key names.
    expect(yamlValueEqual({ a: 1 }, { b: 1 })).toBe(false);
    // Differing key counts.
    expect(yamlValueEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(yamlValueEqual({ a: { b: 2 } }, { a: { b: 2 } })).toBe(true);
  });

  it("handles null-prototype mappings the parser emits", () => {
    // The section parser builds value mappings with Object.create(null),
    // so the comparison must not lean on `obj.hasOwnProperty`. This pins
    // the `Object.prototype.hasOwnProperty.call` path.
    const a = Object.assign(Object.create(null), { x: 1, y: 2 });
    const b = Object.assign(Object.create(null), { x: 1, y: 2 });
    expect(yamlValueEqual(a, b)).toBe(true);
    expect(yamlValueEqual(a, { x: 1, y: 3 })).toBe(false);
  });

  it("compares YamlRawValue blocks by header and body lines", () => {
    const base = new YamlRawValue(["return x + 1;", "return y;"], "|-");
    expect(
      yamlValueEqual(base, new YamlRawValue(["return x + 1;", "return y;"], "|-"))
    ).toBe(true);
    // Body differs.
    expect(
      yamlValueEqual(base, new YamlRawValue(["return x + 2;", "return y;"], "|-"))
    ).toBe(false);
    // Inline header differs (`|-` vs `>-`).
    expect(
      yamlValueEqual(base, new YamlRawValue(["return x + 1;", "return y;"], ">-"))
    ).toBe(false);
    // A raw value is never equal to a non-raw look-alike.
    expect(yamlValueEqual(base, { lines: ["return x + 1;", "return y;"] })).toBe(false);
  });
});

// A section body whose top-level keys span these source lines, with a
// standalone comment leading `brightness` so the lead-run handling is
// exercised.
const LINES = [
  "  name: Living Room", // 0
  "  # nightlight only", // 1 — leads brightness
  "  brightness: 50", //    2
  "  color: red", //        3
];

function makeParsed(comments: Map<string, string> = new Map()): ParsedSection {
  return {
    values: { name: "Living Room", brightness: 50, color: "red" },
    spans: new Map([
      ["name", { leadStart: 0, start: 0, end: 1 }],
      ["brightness", { leadStart: 1, start: 2, end: 3 }],
      ["color", { leadStart: 3, start: 3, end: 4 }],
    ]),
    comments,
    childIndent: "  ",
    isListItem: false,
    startIdx: 0,
  };
}

// `buildSplicedBody` is the diff-and-splice assembler: unchanged keys
// keep their exact source lines (comments included), changed/added keys
// re-serialize. These tests pin the verbatim-copy boundary so a future
// refactor can't silently start reformatting untouched config.
describe("buildSplicedBody", () => {
  it("copies every key verbatim when nothing changed", () => {
    const out = buildSplicedBody(
      LINES,
      makeParsed(),
      { name: "Living Room", brightness: 50, color: "red" },
      new Set(),
      "  ",
      {}
    );
    // Byte-for-byte identical to the source body, comment and all.
    expect(out).toEqual(LINES);
  });

  it("re-serializes a changed scalar but keeps its leading comment", () => {
    const out = buildSplicedBody(
      LINES,
      makeParsed(),
      { name: "Living Room", brightness: 75, color: "red" },
      new Set(),
      "  ",
      {}
    );
    expect(out).toEqual([
      "  name: Living Room",
      "  # nightlight only", // standalone comment survives the edit
      "  brightness: 75", //    value reformatted
      "  color: red",
    ]);
  });

  it("appends a key the parse never saw, in values order", () => {
    const out = buildSplicedBody(
      LINES,
      makeParsed(),
      { name: "Living Room", brightness: 50, color: "red", icon: "home" },
      new Set(),
      "  ",
      {}
    );
    expect(out).toEqual([...LINES, "  icon: home"]);
  });

  it("skips inline (dash-line) keys the caller owns on the header", () => {
    const out = buildSplicedBody(
      LINES,
      makeParsed(),
      { name: "Living Room", brightness: 50, color: "red" },
      new Set(["name"]),
      "  ",
      {}
    );
    expect(out).toEqual(["  # nightlight only", "  brightness: 50", "  color: red"]);
  });

  it("re-appends a trailing inline comment to a single-line scalar edit", () => {
    const out = buildSplicedBody(
      LINES,
      makeParsed(new Map([["brightness", " # dimmed"]])),
      { name: "Living Room", brightness: 75, color: "red" },
      new Set(),
      "  ",
      {}
    );
    expect(out).toContain("  brightness: 75 # dimmed");
  });

  it("does not ride a trailing comment onto a multi-line value", () => {
    // `modes` re-serializes to several lines (a list), so the inline
    // comment has no single scalar line to attach to and is dropped
    // rather than wedged into the middle of the block.
    const parsed = makeParsed(new Map([["color", " # accent"]]));
    const out = buildSplicedBody(
      LINES,
      parsed,
      { name: "Living Room", brightness: 50, color: ["red", "green"] },
      new Set(),
      "  ",
      {}
    );
    expect(out.some((line) => line.includes("# accent"))).toBe(false);
    expect(out).toContain("  color:");
  });
});
