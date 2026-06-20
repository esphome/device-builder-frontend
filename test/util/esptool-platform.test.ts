import { describe, expect, it } from "vitest";
import { isEsptoolPlatform } from "../../src/util/esptool-platform.js";

describe("isEsptoolPlatform", () => {
  it("accepts ESP32 variants and ESP8266 / ESP8285", () => {
    for (const p of [
      "esp32",
      "ESP32",
      "esp32s3",
      "esp32-c3",
      "esp32c6",
      "esp8266",
      "ESP8285",
    ]) {
      expect(isEsptoolPlatform(p)).toBe(true);
    }
  });

  it("rejects non-ESP and unknown platforms (fail-closed)", () => {
    for (const p of [
      "rp2040",
      "rp2350",
      "nrf52",
      "bk72xx",
      "rtl87xx",
      "ln882x",
      "host",
    ]) {
      expect(isEsptoolPlatform(p)).toBe(false);
    }
  });

  it("rejects empty / null / undefined", () => {
    expect(isEsptoolPlatform("")).toBe(false);
    expect(isEsptoolPlatform(null)).toBe(false);
    expect(isEsptoolPlatform(undefined)).toBe(false);
  });
});
