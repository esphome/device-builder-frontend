import {
  PICO_CHIP_NAME,
  PICO_CHIPS,
  PICO_UF2_FAMILY,
  type PicoChip,
} from "../../../platforms/rp2/index.js";
import { parseUf2Image } from "../../../util/uf2.js";
import type { Uf2Image } from "../../../util/uf2.js";
import {
  fetchEsphomeWebManifest,
  fetchPublishedUf2,
  type FirmwareManifest,
  publishedKeys,
  publishedUf2Url,
} from "../../util/esphome-web-firmware.js";

/** The chips the manifest lists a build for. */
export function picoImageChips(manifest: FirmwareManifest): PicoChip[] {
  return publishedKeys(manifest, PICO_CHIPS);
}

/** A Pico UF2 download URL for the manifest's version. */
export const picoUf2Url = (manifest: FirmwareManifest, chip: PicoChip): string =>
  publishedUf2Url(manifest, chip);

/**
 * The manifest's UF2 for ``chip``, fetched and parsed. Throws
 * ``PublishedImageUnavailableError`` when none is published, otherwise with
 * the reason.
 */
export async function loadPicoImage(chip: PicoChip): Promise<Uf2Image> {
  const manifest = await fetchEsphomeWebManifest();
  const bytes = await fetchPublishedUf2(manifest, chip, PICO_CHIP_NAME[chip]);
  return parseUf2Image(bytes, [PICO_UF2_FAMILY[chip]]);
}
