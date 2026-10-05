/**
 * The LibreTiny UF2 as the RTL8710B flasher takes it: the AmebaZ family,
 * both OTA slots resolved up front (the chip's system data picks one once
 * linked), and XModem blocks. The parser itself is shared with the other
 * LibreTiny families.
 */
import { XMODEM_BLOCK_SIZE } from "../../util/xmodem.js";
import {
  type LibreTinyFile,
  type LibreTinyImage,
  libreTinyImageFor,
  type LibreTinyScheme,
  parseLibreTinyFile,
} from "../libretiny-uf2.js";
import {
  AMBZ2_PARSE,
  RtlImageError,
  toRtlImageError,
  UF2_FAMILY_AMBZ,
  UF2_FAMILY_AMBZ2,
} from "./ambz2-image.js";

export { RtlImageError };

/** An RTL8710B build: the image for each OTA slot and where the second slot lives. */
export interface AmbzImage {
  ota1: LibreTinyImage;
  ota2: LibreTinyImage;
  /** The ``ota2`` partition's flash offset, which the chip's system data must point at. */
  ota2Offset: number;
}

/** A parsed RTL87xx UF2 and the chip it was built for. */
export type RtlImage =
  { chip: "ambz2"; image: LibreTinyImage } | { chip: "ambz"; image: AmbzImage };

/**
 * Parse a LibreTiny UF2 for the RTL8710B flasher. Another Realtek family
 * (AmebaZ2) is a real build for the other Realtek flasher's chip; anything
 * else is a bad file. Fails as ``RtlImageError``.
 */
export function parseAmbzImage(bytes: Uint8Array): AmbzImage {
  try {
    return ambzImageOf(parseLibreTinyFile(bytes, [UF2_FAMILY_AMBZ]));
  } catch (err) {
    throw toRtlImageError(err);
  }
}

/** Parse an RTL8720C or RTL8710B UF2 in one pass; its family names the chip. Fails as ``RtlImageError``. */
export function parseRtl87xxImage(bytes: Uint8Array): RtlImage {
  try {
    const file = parseLibreTinyFile(bytes, [UF2_FAMILY_AMBZ2, UF2_FAMILY_AMBZ]);
    return file.familyId === UF2_FAMILY_AMBZ
      ? { chip: "ambz", image: ambzImageOf(file) }
      : { chip: "ambz2", image: libreTinyImageFor(file, AMBZ2_PARSE) };
  } catch (err) {
    throw toRtlImageError(err);
  }
}

function ambzImageOf(file: LibreTinyFile): AmbzImage {
  const slot = (scheme: LibreTinyScheme) =>
    libreTinyImageFor(file, {
      scheme,
      blockSize: XMODEM_BLOCK_SIZE,
      blocksFrom: "run",
    });
  const ota2 = file.partitions.find((p) => p.name === "ota2");
  if (!ota2) throw new Error("Invalid UF2: no 'ota2' partition");
  const image = {
    ota1: slot("flasher-ota1"),
    ota2: slot("flasher-ota2"),
    ota2Offset: ota2.offset,
  };
  // The system data points the bootloader at ``ota2``; the second slot must be what lands there.
  const end = ota2.offset + ota2.length;
  if (
    !image.ota2.runs.every(
      (r) => r.address >= ota2.offset && r.address + r.data.length <= end
    )
  ) {
    throw new Error("Invalid UF2: the second slot is not in the 'ota2' partition");
  }
  return image;
}
