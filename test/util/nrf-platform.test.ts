import { describe, expect, it } from "vitest";

import { isNrfPlatform } from "../../src/util/nrf-platform.js";

describe("isNrfPlatform", () => {
  it.each(["nrf52", "NRF52", "nrf52840"])("accepts %s", (platform) => {
    expect(isNrfPlatform(platform)).toBe(true);
  });

  it.each(["esp32", "esp8266", "rp2", "bk72xx", ""])("rejects %s", (platform) => {
    expect(isNrfPlatform(platform)).toBe(false);
  });

  it("fails closed on a missing platform", () => {
    expect(isNrfPlatform(null)).toBe(false);
    expect(isNrfPlatform(undefined)).toBe(false);
  });
});
