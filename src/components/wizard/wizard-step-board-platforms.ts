/**
 * Platform-filter chip definitions for the wizard's "Select your
 * board" step. Lives in its own module (not on the component
 * class) so the data shape can be unit-tested without spinning up
 * a DOM env to import the Lit component, mirroring the
 * ``password-input-event.ts`` split pattern elsewhere in the repo.
 *
 * - ``platform`` is the canonical ESPHome platform key the backend
 *   exposes via ``_PLATFORM_KEYS`` in
 *   ``helpers/device_yaml.py``. Backend catalogue lookups expect
 *   this value verbatim.
 * - ``variant`` narrows ESP32 chips into their families (S2 / S3 /
 *   C3 / C6 / H2). Empty for non-ESP32 platforms.
 * - ``mcu`` narrows ESPHome's single ``rp2040`` platform into its
 *   two chip series (RP2040 / RP2350). Absent for other platforms.
 * - ``label`` is the user-facing chip text.
 */
import { chipNameToVariant } from "../../util/chip-variant.js";

export interface WizardBoardPlatform {
  readonly platform: string;
  readonly variant: string;
  readonly mcu?: string;
  readonly label: string;
}

export const WIZARD_BOARD_PLATFORMS: readonly WizardBoardPlatform[] = [
  { platform: "esp32", variant: "esp32", label: "ESP32" },
  { platform: "esp32", variant: "esp32s2", label: "ESP32-S2" },
  { platform: "esp32", variant: "esp32s3", label: "ESP32-S3" },
  { platform: "esp32", variant: "esp32c3", label: "ESP32-C3" },
  { platform: "esp32", variant: "esp32c6", label: "ESP32-C6" },
  { platform: "esp32", variant: "esp32h2", label: "ESP32-H2" },
  { platform: "esp32", variant: "esp32p4", label: "ESP32-P4" },
  { platform: "esp8266", variant: "", label: "ESP8266" },
  // ESPHome's 'rp2040' platform covers both the original RP2040 and
  // the newer RP2350; split into two chips (mirroring the per-variant
  // ESP32 chips) so users pick their actual silicon. The backend
  // filters the shared platform by 'mcu'.
  { platform: "rp2040", variant: "", mcu: "rp2040", label: "RP2040" },
  { platform: "rp2040", variant: "", mcu: "rp2350", label: "RP2350" },
  { platform: "bk72xx", variant: "", label: "BK72xx" },
  { platform: "rtl87xx", variant: "", label: "RTL87xx" },
  { platform: "ln882x", variant: "", label: "LN882x" },
  { platform: "nrf52", variant: "", label: "nRF52" },
];

/**
 * Map an esptool-js chip name (e.g. ``"ESP32-C6 (QFN32) (revision
 * v0.2)"``) to the platform-filter label the board picker uses
 * (e.g. ``"ESP32-C6"``). Normalises through ``chipNameToVariant``
 * (handles package-specific descriptions like ``ESP32-D0WD`` →
 * ``esp32`` and ``ESP8266EX`` → ``esp8266``), then matches an
 * existing filter chip. Returns ``null`` when no chip represents the
 * variant (e.g. ESP32-S31/C31/H21) so the caller shows the full
 * picker rather than narrowing to the wrong family.
 */
export function chipNameToFilterLabel(chipName: string): string | null {
  let family = chipNameToVariant(chipName);
  if (family.startsWith("esp82")) family = "esp8266"; // esp8266 / esp8285
  const match = WIZARD_BOARD_PLATFORMS.find(
    (p) =>
      (p.variant && p.variant === family) ||
      p.mcu === family ||
      (!p.variant && !p.mcu && p.platform === family)
  );
  return match?.label ?? null;
}
