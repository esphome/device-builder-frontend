import { describe, expect, it } from "vitest";
import { applyParamPatch } from "../../src/util/param-patch.js";

describe("applyParamPatch", () => {
  it("sets a leaf key without mutating the input", () => {
    const params = { a: 1 };
    const next = applyParamPatch(params, ["b"], 2);
    expect(next).toEqual({ a: 1, b: 2 });
    expect(params).toEqual({ a: 1 });
  });

  it("overwrites an existing leaf key", () => {
    expect(applyParamPatch({ a: 1 }, ["a"], 9)).toEqual({ a: 9 });
  });

  it("deletes a leaf key when the value is undefined", () => {
    expect(applyParamPatch({ a: 1, b: 2 }, ["b"], undefined)).toEqual({ a: 1 });
  });

  it("deletes a leaf key when the value is an empty string", () => {
    expect(applyParamPatch({ a: 1, b: 2 }, ["b"], "")).toEqual({ a: 1 });
  });

  it("keeps a leaf value of 0 / false (only undefined and '' delete)", () => {
    expect(applyParamPatch({}, ["a"], 0)).toEqual({ a: 0 });
    expect(applyParamPatch({}, ["a"], false)).toEqual({ a: false });
  });

  it("replaces the whole dict from an object value at the root path", () => {
    expect(applyParamPatch({ stale: 1 }, [], { fresh: 2 })).toEqual({ fresh: 2 });
  });

  it("clears the dict when the root value is not a plain object", () => {
    expect(applyParamPatch({ a: 1 }, [], "scalar")).toEqual({});
    expect(applyParamPatch({ a: 1 }, [], [1, 2])).toEqual({});
    expect(applyParamPatch({ a: 1 }, [], undefined)).toEqual({});
  });

  it("recurses into a nested path, materializing missing children", () => {
    expect(applyParamPatch({}, ["a", "b"], 3)).toEqual({ a: { b: 3 } });
  });

  it("merges into an existing nested child without dropping siblings", () => {
    const params = { a: { keep: 1 } };
    expect(applyParamPatch(params, ["a", "b"], 2)).toEqual({
      a: { keep: 1, b: 2 },
    });
    expect(params).toEqual({ a: { keep: 1 } });
  });

  it("replaces a non-object child with a fresh dict when recursing", () => {
    expect(applyParamPatch({ a: 5 }, ["a", "b"], 2)).toEqual({ a: { b: 2 } });
  });

  it("deletes a nested leaf when the value is empty", () => {
    expect(applyParamPatch({ a: { b: 1, c: 2 } }, ["a", "b"], "")).toEqual({
      a: { c: 2 },
    });
  });
});
