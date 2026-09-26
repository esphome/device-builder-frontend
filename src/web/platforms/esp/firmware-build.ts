import {
  fetchFirmwareFile,
  type FirmwareManifest,
  type FirmwareManifestBuild,
} from "../../util/esphome-web-firmware.js";

/** A ready-to-flash binary part: raw bytes at a flash offset. */
export interface FlashPart {
  data: Uint8Array;
  address: number;
}

/**
 * Find the build matching a detected chip family. Pure so it can be unit
 * tested against a fixture manifest. ``chipFamily`` is esptool-js's
 * ``chip.CHIP_NAME`` (e.g. ``ESP32-C3``); the manifest keys on the same
 * strings, so this is an exact, case-insensitive match.
 */
export function selectBuild(
  manifest: FirmwareManifest,
  chipFamily: string
): FirmwareManifestBuild | undefined {
  const target = chipFamily.toLowerCase();
  return manifest.builds.find((b) => b.chipFamily.toLowerCase() === target);
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
