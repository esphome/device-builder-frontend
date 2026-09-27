import { getErrorMessage } from "../../util/error-message.js";
import {
  parseUf2Image,
  UF2_FAMILY_RP2040,
  UF2_FAMILY_RP2350_ARM_S,
  Uf2FamilyError,
  type Uf2Image,
} from "../../util/uf2.js";

/** Why a UF2 cannot be written to a Pico: the copy for the user and the detail. */
export interface PicoUf2Failure {
  key: "firmware.rp2_rp2350_unsupported" | "firmware.rp2_bad_uf2";
  detail: string;
}

/**
 * A built UF2 as a Pico image; never throws. Only RP2040 images are
 * flashable from the browser, so an RP2350 one is refused here.
 */
export function parsePicoUf2(bytes: Uint8Array): { image: Uf2Image } | PicoUf2Failure {
  try {
    return { image: parseUf2Image(bytes, [UF2_FAMILY_RP2040]) };
  } catch (err) {
    // Only a real RP2350 image gets the copy-to-drive advice; a missing or
    // unknown family is just a bad file.
    const rp2350 =
      err instanceof Uf2FamilyError && err.familyId === UF2_FAMILY_RP2350_ARM_S;
    return {
      key: rp2350 ? "firmware.rp2_rp2350_unsupported" : "firmware.rp2_bad_uf2",
      detail: getErrorMessage(err),
    };
  }
}
