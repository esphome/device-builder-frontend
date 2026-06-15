import { describe, expect, it } from "vitest";
import { stripRedundantComponentSuffix } from "../../src/util/component-title.js";

describe("stripRedundantComponentSuffix", () => {
  it("trims a trailing ' Component' suffix", () => {
    expect(stripRedundantComponentSuffix("WiFi Component")).toBe("WiFi");
  });

  it("trims a trailing ' Configuration' suffix", () => {
    expect(stripRedundantComponentSuffix("ESPHome Core Configuration")).toBe(
      "ESPHome Core"
    );
  });

  it("leaves a title without a redundant suffix unchanged", () => {
    expect(stripRedundantComponentSuffix("Sensor")).toBe("Sensor");
  });

  it("strips any ' Component' tail — the caller owns the core-only policy", () => {
    // The util is purely textual; restricting it to core titles is the
    // caller's job, so a non-core "Copy Component" is still trimmed here.
    expect(stripRedundantComponentSuffix("Copy Component")).toBe("Copy");
  });

  it("returns the original when stripping would leave an empty string", () => {
    // " Component" -> "" via replace, so the `|| name` guard kicks in.
    expect(stripRedundantComponentSuffix(" Component")).toBe(" Component");
  });

  it("does not match a bare word without the leading space", () => {
    expect(stripRedundantComponentSuffix("Component")).toBe("Component");
  });

  it("only matches the suffix at the end of the string", () => {
    expect(stripRedundantComponentSuffix("Component X")).toBe("Component X");
  });

  it("is case-sensitive", () => {
    expect(stripRedundantComponentSuffix("wifi component")).toBe("wifi component");
  });
});
