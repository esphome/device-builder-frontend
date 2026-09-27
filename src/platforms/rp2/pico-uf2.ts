import { getErrorMessage } from "../../util/error-message.js";
import {
  parseUf2Image,
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

/** A built UF2 as a Pico image, for either chip; never throws. */
export function parsePicoUf2(bytes: Uint8Array): { image: Uf2Image } | PicoUf2Failure {
  try {
    return {
      image: parseUf2Image(bytes, [UF2_FAMILY_RP2040, UF2_FAMILY_RP2350_ARM_S]),
    };
  } catch (err) {
    return { key: "firmware.rp2_bad_uf2", detail: getErrorMessage(err) };
  }
}

/** The chip ``image`` was built for, which the board it is written to has to be. */
export function picoChipOf(image: Uf2Image): PicoChip {
  return image.familyId === UF2_FAMILY_RP2350_ARM_S ? "rp2350" : "rp2040";
}
