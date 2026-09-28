import { describe, expect, it } from "vitest";

import { isBk72xxPlatform } from "../../../src/platforms/bk72xx/bk72xx-platform.js";

describe("isBk72xxPlatform", () => {
  it.each(["bk72xx", "BK72XX"])("accepts %s", (platform) => {
    expect(isBk72xxPlatform(platform)).toBe(true);
  });

  it.each(["esp32", "rp2", "nrf52", "rtl87xx", "ln882x", ""])(
    "rejects %s",
    (platform) => {
      expect(isBk72xxPlatform(platform)).toBe(false);
    }
  );

  it("fails closed on a missing platform", () => {
    expect(isBk72xxPlatform(null)).toBe(false);
    expect(isBk72xxPlatform(undefined)).toBe(false);
  });
});
