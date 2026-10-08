import { getErrorMessage } from "../../util/error-message.js";
import {
  parseUf2Blocks,
  parseUf2Image,
  requireUf2Family,
  UF2_FAMILY_RP2040,
  UF2_FAMILY_RP2350_ARM_S,
  type Uf2Image,
} from "../../util/uf2.js";

/** The chips PICOBOOT writes, as the backend names them. */
export const PICO_CHIPS = ["rp2040", "rp2350"] as const;
export type PicoChip = (typeof PICO_CHIPS)[number];

/** Why a UF2 cannot be written to a Pico: the copy for the user and the detail. */
export interface PicoUf2Failure {
  key: "firmware.rp2_bad_uf2";
  detail: string;
}

/** The UF2 family each chip's image is built for. */
export const PICO_UF2_FAMILY: Record<PicoChip, number> = {
  rp2040: UF2_FAMILY_RP2040,
  rp2350: UF2_FAMILY_RP2350_ARM_S,
};

/** Each chip's part number, the same in every language. */
export const PICO_CHIP_NAME: Record<PicoChip, string> = {
  rp2040: "RP2040",
  rp2350: "RP2350",
};

const PICO_FAMILIES = Object.values(PICO_UF2_FAMILY);

/** A built UF2 as a Pico image, for either chip; never throws. */
export function parsePicoUf2(bytes: Uint8Array): { image: Uf2Image } | PicoUf2Failure {
  try {
    return { image: parseUf2Image(bytes, PICO_FAMILIES) };
  } catch (err) {
    return { key: "firmware.rp2_bad_uf2", detail: getErrorMessage(err) };
  }
}

/** ``parsePicoUf2`` without its ranges, for a check of the file alone; never throws. */
export function checkPicoUf2(bytes: Uint8Array): { familyId: number } | PicoUf2Failure {
  try {
    return { familyId: requireUf2Family(parseUf2Blocks(bytes), PICO_FAMILIES) };
  } catch (err) {
    return { key: "firmware.rp2_bad_uf2", detail: getErrorMessage(err) };
  }
}

/** The chip ``image`` was built for, which the board it is written to has to be. */
export function picoChipOf(image: Uf2Image): PicoChip {
  return image.familyId === UF2_FAMILY_RP2350_ARM_S ? "rp2350" : "rp2040";
}
