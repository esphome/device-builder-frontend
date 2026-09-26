import { describe, expect, it } from "vitest";

import { isRtl87xxPlatform } from "../../../src/platforms/rtl87xx/rtl87xx-platform.js";

describe("isRtl87xxPlatform", () => {
  it.each(["rtl87xx", "RTL87XX"])("accepts %s", (platform) => {
    expect(isRtl87xxPlatform(platform)).toBe(true);
  });

  it.each(["esp32", "rp2", "nrf52", "bk72xx", "ln882x", ""])("rejects %s", (platform) => {
    expect(isRtl87xxPlatform(platform)).toBe(false);
  });

  it("fails closed on a missing platform", () => {
    expect(isRtl87xxPlatform(null)).toBe(false);
    expect(isRtl87xxPlatform(undefined)).toBe(false);
  });
});
