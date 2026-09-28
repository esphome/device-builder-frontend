/**
 * The LibreTiny UF2 as the RTL8720C flasher takes it: the AmebaZ2 family,
 * the first OTA slot as ltchiptool writes it, and XModem blocks. The parser
 * itself is shared with the other LibreTiny families.
 */
import { Uf2FamilyError } from "../../util/uf2.js";
import { XMODEM_BLOCK_SIZE } from "../../util/xmodem.js";
import {
  type LibreTinyImage,
  type LibreTinyParseOptions,
  parseLibreTinyImage,
} from "../libretiny-uf2.js";

/** Realtek AmebaZ2 (RTL8720C), the family the UART engine can flash. */
export const UF2_FAMILY_AMBZ2 = 0xe08f7564;
/** Realtek AmebaZ (RTL8710B): a different ROM protocol, refused up front. */
export const UF2_FAMILY_AMBZ = 0x22e0d6fc;

/** What the RTL8720C flasher writes, and how. */
export const AMBZ2_PARSE: LibreTinyParseOptions = {
  scheme: "flasher-ota1",
  blockSize: XMODEM_BLOCK_SIZE,
  blocksFrom: "run",
};

/** Why an AmebaZ2 image was refused; ``key`` is the install dialogs' title copy. */
export class Ambz2ImageError extends Error {
  constructor(
    readonly key: "firmware.rtl_wrong_family" | "firmware.rtl_bad_uf2",
    readonly cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "Ambz2ImageError";
  }
}

/**
 * Parse a LibreTiny UF2 for the RTL8720C flasher. Another Realtek family
 * (AmebaZ) is a real build for a chip the browser cannot flash; anything
 * else is a bad file. Fails as ``Ambz2ImageError``.
 */
export function parseAmbz2Image(bytes: Uint8Array): LibreTinyImage {
  try {
    return parseLibreTinyImage(bytes, [UF2_FAMILY_AMBZ2], AMBZ2_PARSE);
  } catch (err) {
    throw new Ambz2ImageError(
      err instanceof Uf2FamilyError
        ? "firmware.rtl_wrong_family"
        : "firmware.rtl_bad_uf2",
      err
    );
  }
}
