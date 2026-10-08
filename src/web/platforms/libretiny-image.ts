/**
 * The ESPHome Web firmware published for the LibreTiny families (BK72xx,
 * LN882H, RTL87xx): one UF2 per family, listed in the shared manifest under
 * the family's LibreTiny name (``BK7231N``, ``LN882H``, ``RTL8720C``, ...).
 */
import type { LinkedChip } from "../../platforms/libretiny-flash.js";
import {
  fetchPublishedUf2,
  type FirmwareManifest,
  PublishedImageUnavailableError,
} from "../util/esphome-web-firmware.js";

/**
 * The image ``manifest`` publishes for the linked chip's family, parsed by
 * ``load``. Throws ``PublishedImageUnavailableError`` labelled with the chip
 * when there is none, or none can be told.
 */
export async function linkedImage<Image>(
  load: (bytes: Uint8Array) => Promise<{ image: Image } | { detail: string }>,
  manifest: FirmwareManifest,
  linked: LinkedChip
): Promise<Image> {
  if (!linked.family) throw new PublishedImageUnavailableError(undefined, linked.chip);
  const label = linked.chip ?? linked.family;
  const parsed = await load(await fetchPublishedUf2(manifest, linked.family, label));
  if ("image" in parsed) return parsed.image;
  throw new Error(parsed.detail);
}
