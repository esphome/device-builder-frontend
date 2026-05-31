/**
 * ``hasSerializableValue`` mirrors the per-value skip rules in
 * ``serializeYamlValues`` so the optional-entity enable toggle's
 * checked state agrees with whether the group actually lands in the
 * YAML. These cases pin that agreement.
 */
import { describe, expect, it } from "vitest";
import { YamlRawValue, hasSerializableValue } from "../../src/util/yaml-serialize.js";

describe("hasSerializableValue", () => {
  it("treats undefined / null / empty string as no value", () => {
    expect(hasSerializableValue(undefined)).toBe(false);
    expect(hasSerializableValue(null)).toBe(false);
    expect(hasSerializableValue("")).toBe(false);
  });

  it("treats empty arrays and empty objects as no value", () => {
    expect(hasSerializableValue([])).toBe(false);
    expect(hasSerializableValue({})).toBe(false);
  });

  it("treats a mapping whose descendants are all empty as no value", () => {
    expect(hasSerializableValue({ name: "", id: undefined, nested: {} })).toBe(false);
  });

  it("treats a non-empty list as a value even when its items are empty", () => {
    // serializeListItem emits a bare ``-`` dash for {} / null items,
    // so any non-empty array produces output regardless of contents.
    expect(hasSerializableValue([{}])).toBe(true);
    expect(hasSerializableValue([null])).toBe(true);
  });

  it("treats scalars and non-empty containers as a value", () => {
    expect(hasSerializableValue("x")).toBe(true);
    expect(hasSerializableValue(0)).toBe(true);
    expect(hasSerializableValue(false)).toBe(true);
    expect(hasSerializableValue(["a"])).toBe(true);
    expect(hasSerializableValue({ name: "Min Free" })).toBe(true);
  });

  it("treats a YamlRawValue block as a value", () => {
    expect(hasSerializableValue(new YamlRawValue(["  foo: bar"]))).toBe(true);
  });
});
