/**
 * Map a detected chip description (from esptool-js) to its ESPHome
 * variant string.
 *
 * esptool-js returns specific descriptions like ``ESP32-PICO-D4``,
 * ``ESP32-D0WD``, or ``ESP32-S3-PICO-1``. ESPHome groups all
 * non-sub-variant ESP32 chips under the plain ``esp32`` variant; sub
 * variants (S2/S3, C2/C3/C5/C6/C61, H2, P4) are their own variants and
 * must be matched exactly. ESP8266 has no sub-variants.
 *
 * Sub-variant prefixes are listed longest-first so e.g. ``esp32c61``
 * isn't swallowed by ``esp32c6``.
 */
export function chipNameToVariant(name: string): string {
  const n = name.split("(")[0].trim().toLowerCase().replace(/-/g, "");
  const subVariants = [
    "esp32c61",
    "esp32c2",
    "esp32c3",
    "esp32c5",
    "esp32c6",
    "esp32h2",
    "esp32p4",
    "esp32s2",
    "esp32s3",
    "esp8266",
  ];
  for (const v of subVariants) {
    if (n.startsWith(v)) return v;
  }
  if (n.startsWith("esp32")) return "esp32";
  return n;
}
