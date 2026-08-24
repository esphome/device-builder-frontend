/**
 * Whether a target platform can be flashed from the browser via esptool.
 *
 * ESP32 (all variants) and ESP8266 / ESP8285 speak the esptool ROM protocol,
 * which both Web Serial (esptool-js) and web.esphome.io / esp-web-tools use.
 * Non-ESP targets can't be browser-flashed: RP2040 / RP2350 and nrf52 use a
 * BOOTSEL / 1200-baud touch + UF2 copy, and libretiny (bk72xx / rtl87xx /
 * ln882x) uses ltchiptool's own serial protocol.
 *
 * Fail-closed: an empty / unknown platform returns false, so we never offer a
 * browser flasher that won't work.
 */
export function isEsptoolPlatform(targetPlatform: string | null | undefined): boolean {
  // esp82… covers esp8266 and esp8285.
  return (
    isEsp32Platform(targetPlatform) ||
    (targetPlatform ?? "").toLowerCase().startsWith("esp82")
  );
}

/** ESP32 family, any variant (esp32s3, esp32c6, ...); false for empty / unknown. */
export function isEsp32Platform(targetPlatform: string | null | undefined): boolean {
  return (targetPlatform ?? "").toLowerCase().startsWith("esp32");
}
