/**
 * The LibreTiny UF2 as the RTL8720C flasher takes it: the AmebaZ2 family,
 * the first OTA slot as ltchiptool writes it, and XModem blocks. The parser
 * itself is shared with the other LibreTiny families.
 */
import { Uf2FamilyError } from "../../util/uf2.js";
import { XMODEM_BLOCK_SIZE } from "../../util/xmodem.js";
import {
  type LibreTinyFile,
  type LibreTinyImage,
  type LibreTinyParseOptions,
  parseLibreTinyFile,
  parseLibreTinyImage,
} from "../libretiny-uf2.js";

/** Realtek AmebaZ2 (RTL8720C), the family the UART engine can flash. */
export const UF2_FAMILY_AMBZ2 = 0xe08f7564;
/** Realtek AmebaZ (RTL8710B): a different ROM protocol, with its own flasher. */
export const UF2_FAMILY_AMBZ = 0x22e0d6fc;

/** What the RTL8720C flasher writes, and how. */
export const AMBZ2_PARSE: LibreTinyParseOptions = {
  scheme: "flasher-ota1",
  blockSize: XMODEM_BLOCK_SIZE,
  blocksFrom: "run",
};

/** Why a Realtek image was refused (any of the families); ``key`` is the install dialogs' title copy. */
export class RtlImageError extends Error {
  constructor(
    readonly key: "firmware.rtl_wrong_family" | "firmware.rtl_bad_uf2",
    readonly cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "RtlImageError";
  }
}

/** Another family is a build for some other chip; anything else is a bad file. */
export function toRtlImageError(err: unknown): RtlImageError {
  return new RtlImageError(
    err instanceof Uf2FamilyError ? "firmware.rtl_wrong_family" : "firmware.rtl_bad_uf2",
    err
  );
}

/**
 * Parse a LibreTiny UF2 for the RTL8720C flasher. Another Realtek family
 * (AmebaZ, AmebaD) is a real build for one of the other Realtek flashers'
 * chips; anything else is a bad file. Fails as ``RtlImageError``.
 */
export function parseAmbz2Image(bytes: Uint8Array): LibreTinyImage {
  try {
    return parseLibreTinyImage(bytes, [UF2_FAMILY_AMBZ2], AMBZ2_PARSE);
  } catch (err) {
    throw toRtlImageError(err);
  }
}

/** ``parseAmbz2Image`` without the flash runs. Fails as ``RtlImageError``. */
export function checkAmbz2Uf2(bytes: Uint8Array): LibreTinyFile {
  try {
    return parseLibreTinyFile(bytes, [UF2_FAMILY_AMBZ2]);
  } catch (err) {
    throw toRtlImageError(err);
  }
}
