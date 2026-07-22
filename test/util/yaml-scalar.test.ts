import { describe, expect, it } from "vitest";
import {
  parseFlowList,
  parseScalar,
  splitInlineComment,
  stripQuotes,
} from "../../src/util/yaml-scalar.js";

// A Material Design Icon glyph (Plane-15 Private Use Area) — the value a
// flow-list element must round-trip from its ``\U000F058F`` escape
// (device-builder#1232).
const MDI = String.fromCodePoint(0xf058f);

describe("stripQuotes", () => {
  it("strips a double-quoted wrapper", () => {
    expect(stripQuotes('"hello"')).toBe("hello");
  });

  it("strips a single-quoted wrapper", () => {
    expect(stripQuotes("'hello'")).toBe("hello");
  });

  it("collapses a doubled '' to a literal apostrophe inside single quotes", () => {
    expect(stripQuotes("'it''s'")).toBe("it's");
  });

  it("leaves an unquoted scalar untouched", () => {
    expect(stripQuotes("hello")).toBe("hello");
  });

  it("leaves a mismatched-quote scalar untouched", () => {
    expect(stripQuotes("\"hello'")).toBe("\"hello'");
  });

  it("does not strip an interior quote", () => {
    expect(stripQuotes('say "hi"')).toBe('say "hi"');
  });

  it("returns an empty string for a bare empty quoted pair", () => {
    expect(stripQuotes('""')).toBe("");
    expect(stripQuotes("''")).toBe("");
  });

  it("treats a lone quote char as an empty wrapper", () => {
    // ``startsWith`` and ``endsWith`` both match on a single char, so
    // ``slice(1, -1)`` yields "". Characterization, not a guarantee.
    expect(stripQuotes('"')).toBe("");
  });
});

describe("splitInlineComment", () => {
  it("splits a whitespace-preceded # into value and comment", () => {
    expect(splitInlineComment("true #hides")).toEqual({
      value: "true",
      comment: " #hides",
    });
  });

  it("keeps a # with no preceding whitespace in the value", () => {
    expect(splitInlineComment("Bedroom#2")).toEqual({
      value: "Bedroom#2",
      comment: "",
    });
  });

  it("ignores a # inside a double-quoted scalar", () => {
    expect(splitInlineComment('"a # b"')).toEqual({
      value: '"a # b"',
      comment: "",
    });
  });

  it("ignores a # inside a single-quoted scalar", () => {
    expect(splitInlineComment("'a # b'")).toEqual({
      value: "'a # b'",
      comment: "",
    });
  });

  it("returns an empty comment when there is none", () => {
    expect(splitInlineComment("plain value")).toEqual({
      value: "plain value",
      comment: "",
    });
  });

  it("retains all leading whitespace on the comment", () => {
    expect(splitInlineComment("v   # note")).toEqual({
      value: "v",
      comment: "   # note",
    });
  });

  it("treats a tab before # as a comment boundary", () => {
    expect(splitInlineComment("v\t#note")).toEqual({
      value: "v",
      comment: "\t#note",
    });
  });

  it("does not let a backslash-escaped quote desync the quote tracker", () => {
    // The escaped ``\"`` stays inside the double-quoted span, so the
    // later ``#`` is still quoted and not a comment.
    expect(splitInlineComment('"a \\" # b"')).toEqual({
      value: '"a \\" # b"',
      comment: "",
    });
  });

  it("splits after a closed quote", () => {
    expect(splitInlineComment('"a" # tail')).toEqual({
      value: '"a"',
      comment: " # tail",
    });
  });
});

describe("parseScalar", () => {
  it("coerces an unquoted truthy spelling to boolean true", () => {
    for (const v of ["true", "yes", "on", "enable"]) {
      expect(parseScalar(v)).toBe(true);
    }
  });

  it("coerces an unquoted falsy spelling to boolean false", () => {
    for (const v of ["false", "no", "off", "disable"]) {
      expect(parseScalar(v)).toBe(false);
    }
  });

  it("keeps a quoted boolean spelling as a string", () => {
    expect(parseScalar('"on"')).toBe("on");
    expect(parseScalar("'yes'")).toBe("yes");
  });

  it("strips a trailing inline comment before coercing", () => {
    expect(parseScalar("true #note")).toBe(true);
  });

  it("returns a plain string unchanged", () => {
    expect(parseScalar("hello")).toBe("hello");
  });

  it("does not coerce a numeric scalar (boolean-only coercion)", () => {
    expect(parseScalar("42")).toBe("42");
  });

  it("parses an inline lambda into a LambdaValue", () => {
    expect(parseScalar("!lambda return x + 1;")).toEqual({
      _lambda: "return x + 1;",
      _tag: "!lambda",
    });
  });

  it("strips quotes from a quoted inline lambda body", () => {
    expect(parseScalar("!lambda 'return x;'")).toEqual({
      _lambda: "return x;",
      _tag: "!lambda",
    });
  });

  it("is case-insensitive on boolean spellings", () => {
    expect(parseScalar("ON")).toBe(true);
    expect(parseScalar("Off")).toBe(false);
  });
});

describe("parseFlowList", () => {
  it("splits a simple flow list", () => {
    expect(parseFlowList("[a, b, c]")).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for an empty list", () => {
    expect(parseFlowList("[]")).toEqual([]);
    expect(parseFlowList("[   ]")).toEqual([]);
  });

  it("trims surrounding whitespace from each element", () => {
    expect(parseFlowList("[ a ,  b ]")).toEqual(["a", "b"]);
  });

  it("keeps a comma inside a quoted element intact", () => {
    expect(parseFlowList('["a, b", c]')).toEqual(["a, b", "c"]);
  });

  it("strips single quotes from elements", () => {
    expect(parseFlowList("['a', 'b']")).toEqual(["a", "b"]);
  });

  it("unescapes a double-quoted element to its real code point", () => {
    expect(parseFlowList('["\\U000F058F", plain]')).toEqual([MDI, "plain"]);
  });
});

describe("coerceListScalar via parseFlowList (#1353)", () => {
  it("coerces unquoted plain decimals and floats to numbers", () => {
    expect(parseFlowList("[10, -3, 1.5, 0]")).toEqual([10, -3, 1.5, 0]);
  });

  it("keeps quoted numerics as strings", () => {
    expect(parseFlowList("['10', \"3\"]")).toEqual(["10", "3"]);
  });

  it("keeps hex, exponent, and leading-zero forms as strings", () => {
    // 0x76 round-trips bare through the serializer's hex carve-out; 010 is
    // octal 8 in YAML 1.1 so Number() would silently rewrite it; 1e3 keeps
    // the authored form.
    expect(parseFlowList("[0x76, 1e3, 010]")).toEqual(["0x76", "1e3", "010"]);
  });

  it("leaves substitution references and words alone", () => {
    expect(parseFlowList("[${ch}, abc]")).toEqual(["${ch}", "abc"]);
  });

  it("keeps a >2^53 decimal as a string (no silent digit rewrite)", () => {
    expect(parseFlowList("[18446744073709551615, 1]")).toEqual([
      "18446744073709551615",
      1,
    ]);
  });

  it("coerces every YAML boolean spelling; quotes keep strings", () => {
    // Same rule parseScalar applies to fields: a bare ``on`` is a boolean
    // to the loader, so keeping it a string re-emits it quoted and
    // changes the loaded type.
    expect(parseFlowList("[true, FALSE, on, yes, 'true']")).toEqual([
      true,
      false,
      true,
      true,
      "true",
    ]);
  });

  it("coerces a leading-dot float and negative floats", () => {
    expect(parseFlowList("[.5, -1.5]")).toEqual([0.5, -1.5]);
  });

  it("coerces plus-signed and trailing-dot forms the loader reads as numbers", () => {
    expect(parseFlowList("[+1, 1., +2.5]")).toEqual([1, 1, 2.5]);
  });

  it("coerces underscore-separated numerics; words with underscores stay strings", () => {
    expect(parseFlowList("[1_000, 1_0.5, foo_bar, 1_]")).toEqual([
      1000,
      10.5,
      "foo_bar",
      "1_",
    ]);
  });

  it("keeps an overflowing float mantissa as a string", () => {
    const huge = `${"9".repeat(400)}.5`;
    expect(parseFlowList(`[${huge}]`)).toEqual([huge]);
  });
});
