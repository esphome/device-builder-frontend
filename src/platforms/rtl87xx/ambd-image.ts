/**
 * The LibreTiny UF2 as the RTL8720D flasher takes it: the AmebaD family,
 * the first OTA slot on the flash's sector grid (the loader erases whole
 * sectors), and where the second slot lives, whose signature the flasher
 * clears so the bootloader starts the first. The parser itself is shared
 * with the other LibreTiny families.
 */
import {
  type LibreTinyFile,
  type LibreTinyImage,
  libreTinyImageFor,
  type LibreTinyParseOptions,
  type LibreTinyPartition,
  parseLibreTinyFile,
} from "../libretiny-uf2.js";
import { ota2PartitionOf, RtlImageError, toRtlImageError } from "./ambz2-image.js";

export { RtlImageError };

/** Realtek AmebaD (RTL8720D): a ROM that loads a flash loader, with its own flasher. */
export const UF2_FAMILY_AMBD = 0x3379cfe2;

/**
 * What the RTL8720D flasher writes, and how: the loader erases 4 KiB
 * sectors on the flash grid before the write, so a run pads to those.
 */
const AMBD_PARSE: LibreTinyParseOptions = {
  scheme: "flasher-ota1",
  blockSize: 0x1000,
  blocksFrom: "flash",
};

/** An RTL8720D build: the first slot's image and where the second slot lives. */
export interface AmbdImage {
  image: LibreTinyImage;
  /** The ``ota2`` partition's flash offset: its signature is what the bootloader prefers. */
  ota2Offset: number;
}

/**
 * Parse a LibreTiny UF2 for the RTL8720D flasher. Another Realtek family is
 * a real build for one of the other Realtek flashers' chips; anything else
 * is a bad file. Fails as ``RtlImageError``.
 */
export function parseAmbdImage(bytes: Uint8Array): AmbdImage {
  try {
    return ambdImageOf(parseLibreTinyFile(bytes, [UF2_FAMILY_AMBD]));
  } catch (err) {
    throw toRtlImageError(err);
  }
}

/** ``parseAmbdImage`` without the flash runs. Fails as ``RtlImageError``. */
export function checkAmbdUf2(bytes: Uint8Array): LibreTinyFile {
  try {
    const file = parseLibreTinyFile(bytes, [UF2_FAMILY_AMBD]);
    ota2PartitionOf(file);
    return file;
  } catch (err) {
    throw toRtlImageError(err);
  }
}

/** The first slot's runs and the second slot's offset from a parsed file. */
export function ambdImageOf(file: LibreTinyFile): AmbdImage {
  const ota1 = file.partitions.find((p) => p.name === "ota1");
  if (!ota1) throw new Error("Invalid UF2: no 'ota1' partition");
  const ota2 = ota2PartitionOf(file);
  // Its first sector is erased whole, so it has to start on one.
  if (ota2.offset % AMBD_PARSE.blockSize !== 0) {
    throw new Error("Invalid UF2: the 'ota2' partition is not sector aligned");
  }
  // The flasher clears the second slot's first sector after the write: the
  // slots must not share flash, or the first slot would lose its own head.
  if (overlap(ota1, ota2)) {
    throw new Error("Invalid UF2: the 'ota1' and 'ota2' partitions overlap");
  }
  const image = libreTinyImageFor(file, AMBD_PARSE);
  // The scheme names its partition per block group; only the first slot is written.
  const end = ota1.offset + ota1.length;
  if (
    !image.runs.every((r) => r.address >= ota1.offset && r.address + r.data.length <= end)
  ) {
    throw new Error("Invalid UF2: the first slot is not in the 'ota1' partition");
  }
  return { image, ota2Offset: ota2.offset };
}

const overlap = (a: LibreTinyPartition, b: LibreTinyPartition): boolean =>
  a.offset < b.offset + b.length && b.offset < a.offset + a.length;
