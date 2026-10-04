import { describe, expect, it } from "vitest";

import { isLn882xPlatform } from "../../../src/platforms/ln882x/ln882x-platform.js";

describe("isLn882xPlatform", () => {
  it.each(["ln882x", "LN882X"])("accepts %s", (platform) => {
    expect(isLn882xPlatform(platform)).toBe(true);
  });

  it.each(["esp32", "rp2", "nrf52", "rtl87xx", "bk72xx", ""])(
    "rejects %s",
    (platform) => {
      expect(isLn882xPlatform(platform)).toBe(false);
    }
  );

  it("fails closed on a missing platform", () => {
    expect(isLn882xPlatform(null)).toBe(false);
    expect(isLn882xPlatform(undefined)).toBe(false);
  });
});
