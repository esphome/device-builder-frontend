/**
 * Fetch and select the prebuilt "esphome-web" adoption firmware published at
 * firmware.esphome.io. Used by the ESP "prepare for first use" flow (flash a
 * basic ESPHome image, then Improv-provision Wi-Fi) and the Pico UF2 install.
 *
 * The manifest is the ESP Web Tools shape: ``builds[]`` keyed by ``chipFamily``
 * (matching esptool-js ``chip.CHIP_NAME`` — ``ESP32``, ``ESP32-C3``, …), each
 * with ``parts[]`` of ``{ path, offset }`` relative to the manifest.
 */
export const ESPHOME_WEB_FIRMWARE_PREFIX = "https://firmware.esphome.io/esphome-web";

const MANIFEST_URL = `${ESPHOME_WEB_FIRMWARE_PREFIX}/manifest.json`;

export interface FirmwareManifestPart {
  path: string;
  offset: number;
}

export interface FirmwareManifestBuild {
  chipFamily: string;
  parts: FirmwareManifestPart[];
}

export interface FirmwareManifest {
  version: string;
  builds: FirmwareManifestBuild[];
}

/** A ready-to-flash binary part: raw bytes at a flash offset. */
export interface FlashPart {
  data: Uint8Array;
  address: number;
}

/** Download and parse the esphome-web manifest. */
export async function fetchEsphomeWebManifest(): Promise<FirmwareManifest> {
  const resp = await fetch(MANIFEST_URL);
  if (!resp.ok) {
    throw new Error(`Downloading ESPHome manifest failed (${resp.status})`);
  }
  return (await resp.json()) as FirmwareManifest;
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

/** One file under the firmware prefix, as bytes; throws with the status on failure. */
export async function fetchFirmwareFile(path: string): Promise<Uint8Array> {
  const resp = await fetch(`${ESPHOME_WEB_FIRMWARE_PREFIX}/${path}`);
  if (!resp.ok) throw new Error(`Downloading ${path} failed (${resp.status})`);
  return new Uint8Array(await resp.arrayBuffer());
}
