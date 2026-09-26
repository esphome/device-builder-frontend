import { parseUf2Image, UF2_FAMILY_RP2040 } from "../../../util/uf2.js";
import type { Uf2Image } from "../../../util/uf2.js";
import {
  ESPHOME_WEB_FIRMWARE_PREFIX,
  fetchEsphomeWebManifest,
  fetchFirmwareFile,
  type FirmwareManifest,
} from "../../util/esphome-web-firmware.js";

/** The Raspberry Pi Pico W UF2's path under the prefix for the manifest's version. */
function picoUf2Path(manifest: FirmwareManifest): string {
  return `${manifest.version}/esphome-web-rp2040.uf2`;
}

/** The Raspberry Pi Pico W UF2 download URL for the manifest's version. */
export function picoUf2Url(manifest: FirmwareManifest): string {
  return `${ESPHOME_WEB_FIRMWARE_PREFIX}/${picoUf2Path(manifest)}`;
}

/** The manifest's Pico W UF2, fetched and parsed. Throws with the reason. */
export async function loadPicoImage(): Promise<Uf2Image> {
  const manifest = await fetchEsphomeWebManifest();
  return parseUf2Image(await fetchFirmwareFile(picoUf2Path(manifest)), [
    UF2_FAMILY_RP2040,
  ]);
}
