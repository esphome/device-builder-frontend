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
 * - ``mcu`` narrows a platform that lumps several chips under one
 *   key into its chip series: ``rp2`` into RP2040 / RP2350, and
 *   the LibreTiny platforms (bk72xx / rtl87xx / ln882x) into their
 *   chips (BK7231 / BK7238 / BK7251, RTL8710B / RTL8720C, LN882H).
 *   Absent for platforms split by ``variant`` instead.
 * - ``label`` is the user-facing chip text.
 */
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import { type BoardDetection, detectedBoardId } from "../../platforms/detect-board.js";
import { fetchBoard } from "../../util/board-body-cache.js";
import { chipPlatformFamily } from "../../util/chip-variant.js";
import { RP2_CANONICAL_KEY } from "../../util/component-presence.js";

export interface WizardBoardPlatform {
  readonly platform: string;
  readonly variant: string;
  readonly mcu?: string;
  readonly label: string;
}

/**
 * What a detection narrows the picker to, with the name the banner shows:
 * one chip's filter (``label`` is that chip's), or a whole platform when the
 * detection only knows the family (a Pico's USB ids say rp2, not RP2040
 * versus RP2350; ``label`` then names its chips).
 */
export interface WizardBoardPreset {
  readonly label: string;
  readonly platform?: string;
}

export const WIZARD_BOARD_PLATFORMS: readonly WizardBoardPlatform[] = [
  { platform: "esp32", variant: "esp32", label: "ESP32" },
  { platform: "esp32", variant: "esp32s2", label: "ESP32-S2" },
  { platform: "esp32", variant: "esp32s3", label: "ESP32-S3" },
  { platform: "esp32", variant: "esp32c2", label: "ESP32-C2" },
  { platform: "esp32", variant: "esp32c3", label: "ESP32-C3" },
  { platform: "esp32", variant: "esp32c5", label: "ESP32-C5" },
  { platform: "esp32", variant: "esp32c6", label: "ESP32-C6" },
  { platform: "esp32", variant: "esp32c61", label: "ESP32-C61" },
  { platform: "esp32", variant: "esp32h2", label: "ESP32-H2" },
  { platform: "esp32", variant: "esp32p4", label: "ESP32-P4" },
  { platform: "esp8266", variant: "", label: "ESP8266" },
  // ESPHome's 'rp2' platform covers both the original RP2040 and
  // the newer RP2350; split into two chips (mirroring the per-variant
  // ESP32 chips) so users pick their actual silicon. The backend
  // filters the shared platform by 'mcu'.
  { platform: RP2_CANONICAL_KEY, variant: "", mcu: "rp2040", label: "RP2040" },
  { platform: RP2_CANONICAL_KEY, variant: "", mcu: "rp2350", label: "RP2350" },
  // LibreTiny platforms bundle genuinely different silicon; split each
  // by 'mcu' (the chip series the backend stamps on every board) the
  // same way rp2 is. BK7231N/T/Q share the one 'bk7231' filter.
  { platform: "bk72xx", variant: "", mcu: "bk7231", label: "BK7231" },
  { platform: "bk72xx", variant: "", mcu: "bk7238", label: "BK7238" },
  { platform: "bk72xx", variant: "", mcu: "bk7251", label: "BK7251" },
  { platform: "rtl87xx", variant: "", mcu: "rtl8710b", label: "RTL8710B" },
  { platform: "rtl87xx", variant: "", mcu: "rtl8720c", label: "RTL8720C" },
  { platform: "ln882x", variant: "", mcu: "ln882h", label: "LN882H" },
  { platform: "nrf52", variant: "", label: "nRF52" },
];

/**
 * The preset for a platform known by its key, and its chip (``mcu``) when
 * the detection knows that too: that chip's filter, else the platform's one
 * chip, else the platform as a whole. ``null`` for a platform the picker has
 * no chips for.
 */
export function platformToPreset(
  platform: string,
  mcu?: string
): WizardBoardPreset | null {
  const chips = WIZARD_BOARD_PLATFORMS.filter((p) => p.platform === platform);
  // Only a named chip is looked up: with none, ``p.mcu === undefined`` would
  // pick a variant-only entry (plain ESP32) over the whole platform.
  const chip =
    (mcu === undefined ? undefined : chips.find((p) => p.mcu === mcu)) ??
    (chips.length === 1 ? chips[0] : undefined);
  if (chip) return { label: chip.label };
  if (chips.length === 0) return null;
  return { label: chips.map((p) => p.label).join(" / "), platform };
}

/**
 * Map an esptool-js chip name (e.g. ``"ESP32-C6 (QFN32) (revision
 * v0.2)"``) to the platform-filter label the board picker uses
 * (e.g. ``"ESP32-C6"``). Normalises through ``chipPlatformFamily``
 * (handles package-specific descriptions like ``ESP32-D0WD`` →
 * ``esp32`` and folds the esp82 family, so ``ESP8266EX`` / ``ESP8285``
 * → ``esp8266``), then matches an existing filter chip. Returns
 * ``null`` when no chip represents the
 * variant (e.g. ESP32-S31/C31/H21) so the caller shows the full
 * picker rather than narrowing to the wrong family.
 */
export function chipNameToFilterLabel(chipName: string): string | null {
  const family = chipPlatformFamily(chipName); // folds esp8285 → esp8266
  const match = WIZARD_BOARD_PLATFORMS.find(
    (p) =>
      (p.variant && p.variant === family) ||
      p.mcu === family ||
      (!p.variant && !p.mcu && p.platform === family)
  );
  return match?.label ?? null;
}

/** A chip's filter as a preset, or null when the picker has no chip for it. */
export function chipPreset(chipName: string): WizardBoardPreset | null {
  const label = chipNameToFilterLabel(chipName);
  return label ? { label } : null;
}

/** The board picker's preset for a detection that named no catalog board. */
export function detectionPreset(detection: BoardDetection): WizardBoardPreset | null {
  switch (detection.kind) {
    case "esp":
      return chipPreset(detection.board.chipName);
    case "named":
      return detection.platform
        ? platformToPreset(detection.platform, detection.mcu)
        : null;
    default:
      return null;
  }
}

/**
 * Where a detection lands: the catalog board it named (a factory firmware's
 * app descriptor, or the boot banner), else the picker's preset for what it
 * found, with the board id the lookup did not find (a catalog miss, or a
 * request failure, which ``fetchBoard`` logs and resolves null all the same)
 * so the caller can say the board was named but not found. Both entry
 * points go through here so they behave alike.
 */
export async function resolveDetection(
  api: ESPHomeAPI,
  detection: BoardDetection
): Promise<
  | { board: BoardCatalogEntry }
  | { preset: WizardBoardPreset | null; missedBoard?: string }
> {
  const boardId = detectedBoardId(detection);
  const board = boardId ? await fetchBoard(api, boardId) : null;
  if (board) return { board };
  return { preset: detectionPreset(detection), missedBoard: boardId };
}
