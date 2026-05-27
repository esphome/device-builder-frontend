/**
 * Pre-fill pin-type config entries from a board manifest's pin
 * feature tags.
 *
 * Catalog component entries (e.g. i2c's ``scl`` / ``sda``, uart's
 * ``rx`` / ``tx``) carry symbolic defaults like ``"SCL"`` / ``"SDA"``
 * that ESPHome resolves at compile time. On variants without those
 * aliases (ESP32-C3, ESP32-S3, ...) the resolution either fails
 * outright or produces a pin that doesn't physically exist — invalid
 * YAML the user can't see until they hit compile.
 *
 * Board manifests tag pins with peripheral features (``i2c_scl``,
 * ``i2c_sda``, ``uart_rx``, ``uart_tx``) — when an entry's key
 * matches a feature tag the board exposes, pre-fill the entry with
 * that pin's GPIO number so the YAML is correct out of the box.
 *
 * Bus-like components only: ``audio_adc.es7210`` and other
 * platform-qualified ids (with a ``.`` in the id) are skipped because
 * their pins aren't peripheral defaults — they're entity-specific
 * I/O wiring the user has to choose. Bus entries are bare ids like
 * ``i2c``, ``uart``, ``spi`` so the feature tag is unambiguously
 * ``<componentId>_<entryKey>``.
 *
 * Lives in its own module so the validator-tier tests can pin the
 * board-pin seeding rules without rendering a Lit component.
 */

import type { BoardCatalogEntry, ConfigEntry } from "../api/types.js";
import { ConfigEntryType } from "../api/types.js";

export function seedBoardPinDefaults(
  componentId: string,
  configEntries: ConfigEntry[],
  board: BoardCatalogEntry | null,
  values: Record<string, unknown>
): Record<string, unknown> {
  if (!board?.pins?.length) return values;
  // Platform-qualified ids (``audio_adc.es7210``) → skip. Bus-like
  // bare ids (``i2c``, ``uart``, ``spi``) compose ``<id>_<key>``
  // feature tags that match the board manifest's pin-feature list.
  if (componentId.includes(".")) return values;
  let next = values;
  for (const entry of configEntries) {
    if (entry.type !== ConfigEntryType.PIN) continue;
    if (next[entry.key] !== undefined) continue;
    const featureTag = `${componentId}_${entry.key.toLowerCase()}`;
    const matchingPin = board.pins.find((p) => p.features.includes(featureTag));
    if (!matchingPin) continue;
    next = { ...next, [entry.key]: matchingPin.gpio };
  }
  return next;
}
