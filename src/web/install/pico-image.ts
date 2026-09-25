import { parseUf2Image, UF2_FAMILY_RP2040 } from "../../util/uf2.js";
import type { Uf2Image } from "../../util/uf2.js";
import {
  fetchEsphomeWebManifest,
  fetchFirmwareFile,
  picoUf2Path,
} from "../util/esphome-web-firmware.js";

/** The manifest's Pico W UF2, fetched and parsed. Throws with the reason. */
export async function loadPicoImage(): Promise<Uf2Image> {
  const manifest = await fetchEsphomeWebManifest();
  return parseUf2Image(await fetchFirmwareFile(picoUf2Path(manifest)), [
    UF2_FAMILY_RP2040,
  ]);
}
