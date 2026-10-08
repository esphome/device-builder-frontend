import type { PicoChip } from "../../../platforms/rp2/pico-uf2.js";
import {
  parseUf2Image,
  UF2_FAMILY_RP2040,
  UF2_FAMILY_RP2350_ARM_S,
} from "../../../util/uf2.js";
import type { Uf2Image } from "../../../util/uf2.js";
import {
  ESPHOME_WEB_FIRMWARE_PREFIX,
  fetchEsphomeWebManifest,
  fetchFirmwareFile,
  type FirmwareManifest,
} from "../../util/esphome-web-firmware.js";

const PICO_UF2_FAMILY: Record<PicoChip, number> = {
  rp2040: UF2_FAMILY_RP2040,
  rp2350: UF2_FAMILY_RP2350_ARM_S,
};

/** The manifest publishes no image for this chip. */
export class PicoImageUnavailableError extends Error {
  constructor(readonly chip: PicoChip) {
    super(`No ESPHome Web image for the ${chip.toUpperCase()}`);
    this.name = "PicoImageUnavailableError";
  }
}

/**
 * The chips the manifest has a Pico image for. The RP2040 (Pico W) image is
 * always published; the RP2350 (Pico 2 W) one only when the manifest lists
 * an RP2350 build.
 */
export function picoImageChips(manifest: FirmwareManifest): PicoChip[] {
  const hasRp2350 = manifest.builds.some((b) => b.chipFamily.toLowerCase() === "rp2350");
  return hasRp2350 ? ["rp2040", "rp2350"] : ["rp2040"];
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
  if (!picoImageChips(manifest).includes(chip)) throw new PicoImageUnavailableError(chip);
  return parseUf2Image(await fetchFirmwareFile(picoUf2Path(manifest, chip)), [
    PICO_UF2_FAMILY[chip],
  ]);
}
