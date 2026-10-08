import {
  fetchFirmwareFile,
  type FirmwareManifestBuild,
} from "../../util/esphome-web-firmware.js";

/** A ready-to-flash binary part: raw bytes at a flash offset. */
export interface FlashPart {
  data: Uint8Array;
  address: number;
}

/** Download every part of a build into flashable byte arrays. */
export async function downloadBuildParts(
  build: FirmwareManifestBuild
): Promise<FlashPart[]> {
  return Promise.all(
    build.parts.map(async (part) => ({
      data: await fetchFirmwareFile(part.path),
      address: part.offset,
    }))
  );
}
