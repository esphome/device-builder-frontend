/**
 * The ESPHome Web firmware published for the LibreTiny families (BK72xx,
 * LN882H, RTL87xx): one UF2 per family, listed in the shared manifest under
 * the family's LibreTiny name (``BK7231N``, ``LN882H``, ``RTL8720C``, ...).
 */
import type { LinkedChip } from "../../platforms/libretiny-flash.js";
import { getErrorMessage } from "../../util/error-message.js";
import {
  fetchPublishedUf2,
  type FirmwareManifest,
  PublishedImageUnavailableError,
} from "../util/esphome-web-firmware.js";

/**
 * The published image did not download or did not parse; ``key`` is its
 * copy, the one it would have had were it fetched before the link.
 */
export class LinkedImageError extends Error {
  constructor(
    readonly key: string,
    detail: string
  ) {
    super(detail);
    this.name = "LinkedImageError";
  }
}

/**
 * The image ``manifest`` publishes for the linked chip's family, parsed by
 * ``load``. Throws ``PublishedImageUnavailableError`` labelled with the chip
 * when there is none, or none can be told, and ``LinkedImageError`` when it
 * does not download or does not parse.
 */
export async function linkedImage<Image>(
  load: (
    bytes: Uint8Array
  ) => Promise<{ image: Image } | { key: string; detail: string }>,
  manifest: FirmwareManifest,
  linked: LinkedChip
): Promise<Image> {
  if (!linked.family) throw new PublishedImageUnavailableError(undefined, linked.chip);
  const label = linked.chip ?? linked.family;
  let bytes: Uint8Array;
  try {
    bytes = await fetchPublishedUf2(manifest, linked.family, label);
  } catch (err) {
    if (err instanceof PublishedImageUnavailableError) throw err;
    throw new LinkedImageError(
      "web.install.prebuilt_download_failed",
      getErrorMessage(err)
    );
  }
  const parsed = await load(bytes);
  if ("image" in parsed) return parsed.image;
  throw new LinkedImageError(parsed.key, parsed.detail);
}
