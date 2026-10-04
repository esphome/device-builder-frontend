/**
 * The LibreTiny UF2 as the LN882H flasher takes it: the LN882H family, the
 * single-image layout ltchiptool writes (bootloader, partition table and
 * app at their offsets), and the 4 KiB the RAM code erases at a time from
 * the start of each transfer. The parser itself is shared with the other
 * LibreTiny families.
 */
import { Uf2FamilyError } from "../../util/uf2.js";
import {
  type LibreTinyImage,
  type LibreTinyParseOptions,
  parseLibreTinyImage,
} from "../libretiny-uf2.js";

/** Lightning LN882H, the family the UART engine can flash. */
export const UF2_FAMILY_LN882H = 0xa38090a8;

/** What the LN882H flasher writes, and how. */
export const LN882X_PARSE: LibreTinyParseOptions = {
  scheme: "flasher-single",
  // The RAM code erases the run's length rounded up to 4 KiB from its start
  // before it takes the data, then writes only the bytes the header names.
  blockSize: 0x1000,
  blocksFrom: "run",
};

/** Why an LN882H image was refused; ``key`` is the install dialogs' title copy. */
export class Ln882xImageError extends Error {
  constructor(
    readonly key: "firmware.ln_wrong_family" | "firmware.ln_bad_uf2",
    readonly cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "Ln882xImageError";
  }
}

/** Parse a LibreTiny UF2 for the LN882H flasher. Fails as ``Ln882xImageError``. */
export function parseLn882xImage(bytes: Uint8Array): LibreTinyImage {
  try {
    return parseLibreTinyImage(bytes, [UF2_FAMILY_LN882H], LN882X_PARSE);
  } catch (err) {
    throw new Ln882xImageError(
      err instanceof Uf2FamilyError ? "firmware.ln_wrong_family" : "firmware.ln_bad_uf2",
      err
    );
  }
}
