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

// The Pico install dialog and the ESP adoptable dialog share one manifest
// for a while, across opens. A failure is not kept, so Retry fetches again; a
// tab left open picks up a new release once the cached one has aged out.
const MANIFEST_MAX_AGE_MS = 15 * 60 * 1000;
// A stalled request must not hold every later open waiting on it.
const MANIFEST_TIMEOUT_MS = 30 * 1000;

let manifest: { promise: Promise<FirmwareManifest>; fetchedAt: number } | undefined;

/** Download and parse the esphome-web manifest, reusing a recent one. */
export function fetchEsphomeWebManifest(): Promise<FirmwareManifest> {
  if (!manifest || Date.now() - manifest.fetchedAt > MANIFEST_MAX_AGE_MS) {
    const entry = {
      promise: downloadManifest().catch((err: unknown) => {
        if (manifest === entry) manifest = undefined;
        throw err;
      }),
      fetchedAt: Date.now(),
    };
    manifest = entry;
  }
  return manifest.promise;
}

/** Forget the cached manifest (tests). */
export function resetEsphomeWebManifest(): void {
  manifest = undefined;
}

async function downloadManifest(): Promise<FirmwareManifest> {
  const resp = await fetch(MANIFEST_URL, {
    signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
  });
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
