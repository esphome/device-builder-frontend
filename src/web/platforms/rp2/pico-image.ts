import {
  PICO_CHIP_NAME,
  PICO_CHIPS,
  PICO_UF2_FAMILY,
  type PicoChip,
} from "../../../platforms/rp2/pico-uf2.js";
import { parseUf2Image } from "../../../util/uf2.js";
import type { Uf2Image } from "../../../util/uf2.js";
import {
  ESPHOME_WEB_FIRMWARE_PREFIX,
  fetchEsphomeWebManifest,
  fetchFirmwareFile,
  type FirmwareManifest,
  selectBuild,
} from "../../util/esphome-web-firmware.js";

/** The manifest publishes no image for this chip. */
export class PicoImageUnavailableError extends Error {
  constructor(readonly chip: PicoChip) {
    super(`No ESPHome Web image for the ${PICO_CHIP_NAME[chip]}`);
    this.name = "PicoImageUnavailableError";
  }
}

/** The chips the manifest lists a build for. */
export function picoImageChips(manifest: FirmwareManifest): PicoChip[] {
  return PICO_CHIPS.filter((chip) => selectBuild(manifest, chip));
}

/** A Pico UF2's path under the prefix for the manifest's version. */
function picoUf2Path(manifest: FirmwareManifest, chip: PicoChip): string {
  return `${manifest.version}/esphome-web-${chip}.uf2`;
}

/** A Pico UF2 download URL for the manifest's version. */
export function picoUf2Url(manifest: FirmwareManifest, chip: PicoChip): string {
  return `${ESPHOME_WEB_FIRMWARE_PREFIX}/${picoUf2Path(manifest, chip)}`;
}

/**
 * The manifest's UF2 for ``chip``, fetched and parsed. Throws
 * ``PicoImageUnavailableError`` when none is published, otherwise with the
 * reason.
 */
export async function loadPicoImage(chip: PicoChip): Promise<Uf2Image> {
  const manifest = await fetchEsphomeWebManifest();
  if (!selectBuild(manifest, chip)) throw new PicoImageUnavailableError(chip);
  return parseUf2Image(await fetchFirmwareFile(picoUf2Path(manifest, chip)), [
    PICO_UF2_FAMILY[chip],
  ]);
}
