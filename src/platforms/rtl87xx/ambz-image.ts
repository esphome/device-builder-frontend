/**
 * The LibreTiny UF2 as the RTL8710B flasher takes it: the AmebaZ family,
 * both OTA slots resolved up front (the chip's system data picks one once
 * linked), and XModem blocks. The parser itself is shared with the other
 * LibreTiny families.
 */
import { Uf2FamilyError } from "../../util/uf2.js";
import { XMODEM_BLOCK_SIZE } from "../../util/xmodem.js";
import {
  type LibreTinyImage,
  type LibreTinyParseOptions,
  LT_TAG,
  parseLibreTinyBlocks,
  parseLibreTinyImage,
  parsePartitionTable,
} from "../libretiny-uf2.js";
import { UF2_FAMILY_AMBZ } from "./ambz2-image.js";

const AMBZ_PARSE = { blockSize: XMODEM_BLOCK_SIZE, blocksFrom: "run" } as const;
export const AMBZ_PARSE_OTA1: LibreTinyParseOptions = {
  scheme: "flasher-ota1",
  ...AMBZ_PARSE,
};
export const AMBZ_PARSE_OTA2: LibreTinyParseOptions = {
  scheme: "flasher-ota2",
  ...AMBZ_PARSE,
};

/** An RTL8710B build: the image for each OTA slot and where the second slot lives. */
export interface AmbzImage {
  ota1: LibreTinyImage;
  ota2: LibreTinyImage;
  /** The ``ota2`` partition's flash offset, which the chip's system data must point at. */
  ota2Offset: number;
}

/** Why an AmebaZ image was refused; ``key`` is the install dialogs' title copy. */
export class AmbzImageError extends Error {
  constructor(
    readonly key: "firmware.rtl_wrong_family" | "firmware.rtl_bad_uf2",
    readonly cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "AmbzImageError";
  }
}

function ota2Offset(bytes: Uint8Array): number {
  for (const block of parseLibreTinyBlocks(bytes)) {
    const table = block.tags.get(LT_TAG.FAL_PTABLE);
    if (!table) continue;
    const part = parsePartitionTable(table).find((p) => p.name === "ota2");
    if (part) return part.offset;
  }
  throw new Error("Invalid UF2: no 'ota2' partition");
}

/**
 * Parse a LibreTiny UF2 for the RTL8710B flasher. Another Realtek family
 * (AmebaZ2) is a real build for a different chip; anything else is a bad
 * file. Fails as ``AmbzImageError``.
 */
export function parseAmbzImage(bytes: Uint8Array): AmbzImage {
  try {
    return {
      ota1: parseLibreTinyImage(bytes, [UF2_FAMILY_AMBZ], AMBZ_PARSE_OTA1),
      ota2: parseLibreTinyImage(bytes, [UF2_FAMILY_AMBZ], AMBZ_PARSE_OTA2),
      ota2Offset: ota2Offset(bytes),
    };
  } catch (err) {
    throw new AmbzImageError(
      err instanceof Uf2FamilyError
        ? "firmware.rtl_wrong_family"
        : "firmware.rtl_bad_uf2",
      err
    );
  }
}
