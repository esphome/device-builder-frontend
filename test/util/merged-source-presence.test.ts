import { describe, expect, it } from "vitest";
import { withMergedSourcePresence } from "../../src/util/merged-source-presence.js";

const RESOLVED = ["esp32", "api", "wifi"];

describe("withMergedSourcePresence", () => {
  it("widens the set for a packages: config", () => {
    const present = new Set(["api", "substitutions"]);
    const widened = withMergedSourcePresence(
      present,
      "packages:\n  base: github://acme/base.yaml\napi:\n",
      RESOLVED
    );
    expect(widened.has("esp32")).toBe(true);
    expect(widened.has("substitutions")).toBe(true);
    expect(present.has("esp32")).toBe(false);
  });

  it("widens with both alias spellings of a platform key", () => {
    const widened = withMergedSourcePresence(new Set(), "packages:\n  base: x.yaml\n", [
      "rp2",
    ]);
    expect(widened.has("rp2")).toBe(true);
    expect(widened.has("rp2040")).toBe(true);
  });

  it("returns the set unchanged for a plain config", () => {
    const present = new Set(["api"]);
    expect(withMergedSourcePresence(present, "api:\nesphome:\n", RESOLVED)).toBe(present);
  });

  it("returns the set unchanged when nothing was resolved", () => {
    const present = new Set<string>();
    expect(withMergedSourcePresence(present, "packages:\n  base: x.yaml\n", [])).toBe(
      present
    );
  });
});
