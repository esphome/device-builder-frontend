import { describe, expect, it } from "vitest";

import { isRp2Platform } from "../../src/util/rp2-platform.js";

describe("isRp2Platform", () => {
  it.each(["rp2", "RP2", "rp2040", "rp2350"])("accepts %s", (platform) => {
    expect(isRp2Platform(platform)).toBe(true);
  });

  it.each(["esp32", "esp8266", "nrf52", "bk72xx", ""])("rejects %s", (platform) => {
    expect(isRp2Platform(platform)).toBe(false);
  });

  it("fails closed on a missing platform", () => {
    expect(isRp2Platform(null)).toBe(false);
    expect(isRp2Platform(undefined)).toBe(false);
  });
});
