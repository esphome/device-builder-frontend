/**
 * Fetch the prebuilt "esphome-web" adoption firmware published at
 * firmware.esphome.io: the manifest and single files under its prefix. The
 * ESP build selection lives in ``platforms/esp/firmware-build.ts`` and the
 * Pico UF2 in ``platforms/rp2/pico-image.ts``.
 *
 * The manifest is the ESP Web Tools shape: ``builds[]`` keyed by ``chipFamily``
 * (matching esptool-js ``chip.CHIP_NAME``: ``ESP32``, ``ESP32-C3``, ...), each
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

// One manifest per page: the Pico install dialog's opens and the ESP adoptable
// dialog share it. A failure is not kept, so Retry fetches again.
let manifest: Promise<FirmwareManifest> | undefined;

/** Download and parse the esphome-web manifest, once per page. */
export function fetchEsphomeWebManifest(): Promise<FirmwareManifest> {
  manifest ??= downloadManifest().catch((err: unknown) => {
    manifest = undefined;
    throw err;
  });
  return manifest;
}

/** Forget the cached manifest (tests). */
export function resetEsphomeWebManifest(): void {
  manifest = undefined;
}

async function downloadManifest(): Promise<FirmwareManifest> {
  const resp = await fetch(MANIFEST_URL);
  if (!resp.ok) {
    throw new Error(`Downloading ESPHome manifest failed (${resp.status})`);
  }
  return (await resp.json()) as FirmwareManifest;
}

/** One file under the firmware prefix, as bytes; throws with the status on failure. */
export async function fetchFirmwareFile(path: string): Promise<Uint8Array> {
  const resp = await fetch(`${ESPHOME_WEB_FIRMWARE_PREFIX}/${path}`);
  if (!resp.ok) throw new Error(`Downloading ${path} failed (${resp.status})`);
  return new Uint8Array(await resp.arrayBuffer());
}
