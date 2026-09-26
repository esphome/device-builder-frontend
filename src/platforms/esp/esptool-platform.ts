/**
 * Whether a target platform can be flashed from the browser via esptool.
 *
 * ESP32 (all variants) and ESP8266 / ESP8285 speak the esptool ROM protocol,
 * which both Web Serial (esptool-js) and web.esphome.io / esp-web-tools use.
 * Other targets don't speak it: libretiny (bk72xx / rtl87xx / ln882x) uses
 * ltchiptool's own serial protocol, nrf52 has its own in-app Nordic DFU path
 * (``nrf-platform.ts``) and RP2 its PICOBOOT / UF2 path (``rp2-platform.ts``).
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
