import { describe, expect, it } from "vitest";
import { isComponentPresent } from "../../src/util/component-presence.js";

describe("isComponentPresent", () => {
  const present = new Set(["ethernet", "wifi"]);
  const presentPlatforms = new Set(["time.homeassistant"]);

  it("matches a bare id against top-level blocks", () => {
    expect(isComponentPresent("ethernet", present, presentPlatforms)).toBe(true);
    expect(isComponentPresent("api", present, presentPlatforms)).toBe(false);
  });

  it("matches a platform-variant id against configured platforms", () => {
    expect(isComponentPresent("time.homeassistant", present, presentPlatforms)).toBe(
      true
    );
    expect(isComponentPresent("time.sntp", present, presentPlatforms)).toBe(false);
  });

  it("matches rp2 and rp2040 against either block spelling", () => {
    expect(isComponentPresent("rp2040", new Set(["rp2"]), presentPlatforms)).toBe(true);
    expect(isComponentPresent("rp2", new Set(["rp2040"]), presentPlatforms)).toBe(true);
    expect(isComponentPresent("rp2040", present, presentPlatforms)).toBe(false);
  });
});
