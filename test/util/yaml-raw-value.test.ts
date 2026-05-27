/**
 * Unit tests for ``YamlRawValue``'s editor-friendly accessors.
 *
 * The parser captures block scalars (``lambda: |-``, ``packages:``
 * shorthand, automation handlers) as ``YamlRawValue`` so the
 * round-trip preserves the on-disk style. The form renderers used
 * to ``String()`` these directly which produced
 * ``"[object Object]"`` — issue #428. The class now exposes
 * ``body`` / ``indent`` / ``toString`` for the renderer side and
 * ``fromBodyText`` for the round-trip on edit.
 */

import { describe, expect, it } from "vitest";
import { YamlRawValue } from "../../src/util/yaml-serialize.js";

describe("YamlRawValue.toString", () => {
  it("returns the dedented body so String(rawValue) is editor-friendly", () => {
    // Mirrors what the parser produces for ``lambda: |-`` whose
    // body is indented 6 spaces under a list-item child:
    //
    //     - platform: template
    //       lambda: |-
    //         return foo;
    //         return bar;
    const raw = new YamlRawValue(["        return foo;", "        return bar;"], "|-");
    expect(String(raw)).toBe("return foo;\nreturn bar;");
  });

  it("matches the body getter", () => {
    const raw = new YamlRawValue(["    return foo;"], "|-");
    expect(String(raw)).toBe(raw.body);
  });

  it("template-literal interpolation produces the body", () => {
    const raw = new YamlRawValue(["    abc"], "|-");
    expect(`${raw}`).toBe("abc");
  });
});

describe("YamlRawValue.indent", () => {
  it("picks the common leading whitespace of every non-blank line", () => {
    const raw = new YamlRawValue(
      ["    return foo;", "    if (bar) {", "      return baz;", "    }"],
      "|-"
    );
    expect(raw.indent).toBe("    ");
  });

  it("ignores blank lines when computing the common indent", () => {
    // A blank middle line shouldn't collapse the common indent
    // to "" — the body's indent comes from the non-blank lines.
    const raw = new YamlRawValue(["    return foo;", "", "    return bar;"], "|-");
    expect(raw.indent).toBe("    ");
  });

  it("returns empty string when the lines have no shared indent", () => {
    const raw = new YamlRawValue(["return foo;", "  return bar;"], "|-");
    expect(raw.indent).toBe("");
  });

  it("returns empty string when the lines are all blank", () => {
    const raw = new YamlRawValue(["", "", ""], "|-");
    expect(raw.indent).toBe("");
  });

  it("handles a single line", () => {
    const raw = new YamlRawValue(["      return foo;"], "|-");
    expect(raw.indent).toBe("      ");
  });
});

describe("YamlRawValue.body", () => {
  it("strips the common indent across all lines", () => {
    const raw = new YamlRawValue(["    return foo;", "    return bar;"], "|-");
    expect(raw.body).toBe("return foo;\nreturn bar;");
  });

  it("preserves indentation deeper than the common one", () => {
    // Inside a lambda body the user might have nested braces with
    // their own indent — the common-prefix stripping must keep
    // those deeper indents intact, otherwise we'd corrupt the
    // user's formatting on display.
    const raw = new YamlRawValue(["    if (x) {", "      return foo;", "    }"], "|-");
    expect(raw.body).toBe("if (x) {\n  return foo;\n}");
  });

  it("preserves blank lines verbatim", () => {
    const raw = new YamlRawValue(["    return foo;", "", "    return bar;"], "|-");
    expect(raw.body).toBe("return foo;\n\nreturn bar;");
  });
});

describe("YamlRawValue.fromBodyText", () => {
  it("re-applies the original common indent and preserves the inline header", () => {
    const original = new YamlRawValue(["    return foo;", "    return bar;"], "|-");
    const edited = YamlRawValue.fromBodyText("return baz;\nreturn qux;", original);
    expect(edited.lines).toEqual(["    return baz;", "    return qux;"]);
    expect(edited.inlineHeader).toBe("|-");
  });

  it("round-trips a body unchanged", () => {
    // ``original.body → fromBodyText → .body`` must be identity for
    // the no-edit case, otherwise opening + saving without typing
    // would mutate the YAML.
    const original = new YamlRawValue(["    return foo;", "      return bar;"], "|-");
    const roundTripped = YamlRawValue.fromBodyText(original.body, original);
    expect(roundTripped.body).toBe(original.body);
  });

  it("emits empty lines without leading whitespace", () => {
    // YAML block-scalar bodies can have blank lines; those should
    // round-trip as TRULY empty lines (no trailing whitespace) so
    // a subsequent re-parse doesn't see "this is a continuation."
    const original = new YamlRawValue(["    return foo;", "    return bar;"], "|-");
    const edited = YamlRawValue.fromBodyText("return foo;\n\nreturn bar;", original);
    expect(edited.lines).toEqual(["    return foo;", "", "    return bar;"]);
  });

  it("handles bodies with no original indent (zero-prefix lines)", () => {
    // Edge case: an inline ``key: |- some_text`` shape would parse
    // into a YamlRawValue whose lines have no shared indent. The
    // helper shouldn't blow up — just emit what the user typed.
    const original = new YamlRawValue(["return foo;"], "|-");
    const edited = YamlRawValue.fromBodyText("return baz;", original);
    expect(edited.lines).toEqual(["return baz;"]);
  });

  it("preserves the inline header when it's undefined (list-rooted block)", () => {
    // A list-rooted block (``on_press:`` → ``- lambda:``) has no
    // inline header — the dash row sits inside ``lines`` instead.
    // Editing that shape via this helper is a degraded path
    // documented in the class JSDoc; we still preserve undefined
    // so the serializer's branch logic keeps working.
    const original = new YamlRawValue(["  - lambda: !lambda return 1;"]);
    const edited = YamlRawValue.fromBodyText("foo", original);
    expect(edited.inlineHeader).toBeUndefined();
  });
});
