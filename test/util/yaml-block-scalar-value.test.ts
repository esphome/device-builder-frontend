/**
 * Tests for the block-scalar -> form-value coercion split out of
 * yaml-section-reader.ts.
 *
 * Only the canonical strip-chomped literal lambda (`!lambda |-`) becomes
 * an editable LambdaValue; every other tag/marker (folded `>`, keep
 * `|+`, plain `|-`, `!secret`, ...) stays an opaque YamlRawValue so the
 * editor round-trips it verbatim instead of normalising away semantics
 * it doesn't model.
 */

import { describe, expect, it } from "vitest";

import {
  blockScalarValue,
  isEditableLambdaBlock,
  lambdaValueFromBlock,
} from "../../src/util/yaml-block-scalar-value.js";
import type { BlockScalarHeader } from "../../src/util/yaml-section-lexer.js";
import { YamlRawValue } from "../../src/util/yaml-serialize.js";

const header = (tag: string | undefined, marker: string): BlockScalarHeader => ({
  tag,
  marker,
});

describe("isEditableLambdaBlock", () => {
  it("accepts only the canonical strip-chomped literal lambda", () => {
    expect(isEditableLambdaBlock(header("!lambda", "|-"))).toBe(true);
  });

  it("rejects a lambda with a non-strip marker", () => {
    // Folded / keep / clip carry chomp+fold semantics the lambda editor
    // would normalise away, so they stay opaque.
    expect(isEditableLambdaBlock(header("!lambda", ">"))).toBe(false);
    expect(isEditableLambdaBlock(header("!lambda", "|+"))).toBe(false);
    expect(isEditableLambdaBlock(header("!lambda", "|"))).toBe(false);
  });

  it("rejects a strip block with no tag (plain literal)", () => {
    expect(isEditableLambdaBlock(header(undefined, "|-"))).toBe(false);
  });

  it("rejects a different tag even with the strip marker", () => {
    expect(isEditableLambdaBlock(header("!secret", "|-"))).toBe(false);
  });
});

describe("lambdaValueFromBlock", () => {
  it("dedents the body and tags it as a lambda", () => {
    expect(lambdaValueFromBlock(["    return foo;", "    return bar;"])).toEqual({
      _lambda: "return foo;\nreturn bar;",
      _tag: "!lambda",
    });
  });

  it("strips trailing blank lines (the |- chomp)", () => {
    expect(lambdaValueFromBlock(["  return x;", "", ""])).toEqual({
      _lambda: "return x;",
      _tag: "!lambda",
    });
  });

  it("preserves trailing spaces on the last line", () => {
    // The strip chomp only drops trailing newlines, not spaces.
    expect(lambdaValueFromBlock(["  return x;  "])).toEqual({
      _lambda: "return x;  ",
      _tag: "!lambda",
    });
  });

  it("yields an empty lambda for an empty body", () => {
    expect(lambdaValueFromBlock([])).toEqual({ _lambda: "", _tag: "!lambda" });
  });
});

describe("blockScalarValue", () => {
  it("returns an editable LambdaValue for a canonical !lambda |-", () => {
    const value = blockScalarValue(header("!lambda", "|-"), "!lambda |-", [
      "    return id(x);",
    ]);
    expect(value).toEqual({ _lambda: "return id(x);", _tag: "!lambda" });
    expect(value).not.toBeInstanceOf(YamlRawValue);
  });

  it("wraps a non-editable block in a YamlRawValue carrying the raw header", () => {
    const lines = ["  line one", "  line two"];
    const value = blockScalarValue(header("!lambda", ">"), "!lambda >", lines);
    expect(value).toBeInstanceOf(YamlRawValue);
    const raw = value as YamlRawValue;
    expect(raw.inlineHeader).toBe("!lambda >");
    expect(raw.lines).toEqual(lines);
    // The verbatim lines round-trip; body just dedents for display.
    expect(raw.body).toBe("line one\nline two");
  });

  it("treats a plain (untagged) strip block as opaque", () => {
    const value = blockScalarValue(header(undefined, "|-"), "|-", ["  text"]);
    expect(value).toBeInstanceOf(YamlRawValue);
    expect((value as YamlRawValue).inlineHeader).toBe("|-");
  });
});
