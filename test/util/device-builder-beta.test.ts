import { describe, expect, it } from "vitest";
import { isDeviceBuilderBeta } from "../../src/util/device-builder-beta.js";

describe("isDeviceBuilderBeta", () => {
  it("treats a plain dotted-digit version as stable", () => {
    expect(isDeviceBuilderBeta("0.1.0")).toBe(false);
    expect(isDeviceBuilderBeta("1.0.0")).toBe(false);
    expect(isDeviceBuilderBeta("2026.5.3")).toBe(false);
  });

  it("ignores a leading v", () => {
    expect(isDeviceBuilderBeta("v0.1.0")).toBe(false);
    expect(isDeviceBuilderBeta("v0.0.0")).toBe(true);
  });

  it("flags any PEP 440 pre-release / dev / local suffix as beta", () => {
    expect(isDeviceBuilderBeta("0.1.0b117")).toBe(true);
    expect(isDeviceBuilderBeta("0.2.0rc1")).toBe(true);
    expect(isDeviceBuilderBeta("0.1.0a1")).toBe(true);
    expect(isDeviceBuilderBeta("0.1.0.dev5+g1234")).toBe(true);
  });

  it("assumes beta when the version is empty or 0.0.0", () => {
    expect(isDeviceBuilderBeta("")).toBe(true);
    expect(isDeviceBuilderBeta("   ")).toBe(true);
    expect(isDeviceBuilderBeta("0.0.0")).toBe(true);
  });
});
