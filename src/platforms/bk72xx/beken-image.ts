/**
 * The LibreTiny UF2 as the Beken flasher takes it: a Beken family, the
 * single scheme as ltchiptool writes it, and the 4 KiB sectors of the
 * flash, which are erased and written whole.
 */
import { Uf2FamilyError } from "../../util/uf2.js";
import {
  type LibreTinyFile,
  type LibreTinyImage,
  type LibreTinyParseOptions,
  parseLibreTinyFile,
  parseLibreTinyImage,
} from "../libretiny-uf2.js";
import { BEKEN_FAMILIES } from "./beken-chips.js";
import { SECTOR_SIZE } from "./beken-packets.js";

/** What the Beken flasher writes, and how. */
export const BEKEN_PARSE: LibreTinyParseOptions = {
  scheme: "flasher-single",
  blockSize: SECTOR_SIZE,
  blocksFrom: "flash",
};

/** Why a Beken image was refused; ``key`` is the install dialogs' title copy. */
export class BekenImageError extends Error {
  constructor(
    readonly key: "firmware.bk_wrong_family" | "firmware.bk_bad_uf2",
    readonly cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "BekenImageError";
  }
}

/** Another family is a real build for a chip this flasher cannot write; anything else is a bad file. */
export function toBekenImageError(err: unknown): BekenImageError {
  return new BekenImageError(
    err instanceof Uf2FamilyError ? "firmware.bk_wrong_family" : "firmware.bk_bad_uf2",
    err
  );
}

const BEKEN_FAMILY_IDS = BEKEN_FAMILIES.map((f) => f.id);

/** Parse a LibreTiny UF2 for the Beken flasher. Fails as ``BekenImageError``. */
export function parseBekenImage(bytes: Uint8Array): LibreTinyImage {
  try {
    return parseLibreTinyImage(bytes, BEKEN_FAMILY_IDS, BEKEN_PARSE);
  } catch (err) {
    throw toBekenImageError(err);
  }
}

/** ``parseBekenImage`` as far as the file's header goes, without its flash runs. Fails as ``BekenImageError``. */
export function checkBekenUf2(bytes: Uint8Array): LibreTinyFile {
  try {
    return parseLibreTinyFile(bytes, BEKEN_FAMILY_IDS);
  } catch (err) {
    throw toBekenImageError(err);
  }
}
