/**
 * The RTL87xx UF2 as web.esphome.io takes it, before the chip is known: the
 * family names the chip, and the chip's own parser the image. One table
 * holds both, so a chip is added in one place.
 */
import {
  type LibreTinyFile,
  type LibreTinyImage,
  libreTinyImageFor,
  parseLibreTinyFile,
} from "../libretiny-uf2.js";
import { type AmbdImage, ambdImageOf, UF2_FAMILY_AMBD } from "./ambd-image.js";
import { type AmbzImage, ambzImageOf } from "./ambz-image.js";
import {
  AMBZ2_PARSE,
  RtlImageError,
  toRtlImageError,
  UF2_FAMILY_AMBZ,
  UF2_FAMILY_AMBZ2,
} from "./ambz2-image.js";

export { RtlImageError };

/** A parsed RTL87xx UF2 and the chip it was built for. */
export type RtlImage =
  | { chip: "ambz2"; image: LibreTinyImage }
  | { chip: "ambz"; image: AmbzImage }
  | { chip: "ambd"; image: AmbdImage };

const CHIPS: ReadonlyArray<{ family: number; parse: (file: LibreTinyFile) => RtlImage }> =
  [
    {
      family: UF2_FAMILY_AMBZ2,
      parse: (file) => ({ chip: "ambz2", image: libreTinyImageFor(file, AMBZ2_PARSE) }),
    },
    {
      family: UF2_FAMILY_AMBZ,
      parse: (file) => ({ chip: "ambz", image: ambzImageOf(file) }),
    },
    {
      family: UF2_FAMILY_AMBD,
      parse: (file) => ({ chip: "ambd", image: ambdImageOf(file) }),
    },
  ];

/** Parse an RTL87xx UF2 in one pass; its family names the chip. Fails as ``RtlImageError``. */
export function parseRtl87xxImage(bytes: Uint8Array): RtlImage {
  try {
    const file = parseLibreTinyFile(
      bytes,
      CHIPS.map((c) => c.family)
    );
    return CHIPS.find((c) => c.family === file.familyId)!.parse(file);
  } catch (err) {
    throw toRtlImageError(err);
  }
}
