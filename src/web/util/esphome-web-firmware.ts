/**
 * Fetch the prebuilt "esphome-web" adoption firmware published at
 * firmware.esphome.io: the manifest, single files under its prefix, and the
 * UF2 published per chip or family (the Pico's and the LibreTiny families').
 * The ESP parts download lives in ``platforms/esp/firmware-build.ts``.
 *
 * The manifest is the ESP Web Tools shape: ``builds[]`` keyed by ``chipFamily``
 * (matching esptool-js ``chip.CHIP_NAME``: ``ESP32``, ``ESP32-C3``, ...), each
 * with ``parts[]`` of ``{ path, offset }`` relative to the manifest.
 */
import { KeyedPromiseCache } from "../../util/keyed-promise-cache.js";

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

/**
 * Find the build for a chip family, an exact, case-insensitive match. For an
 * ESP the family is esptool-js's ``chip.CHIP_NAME`` (e.g. ``ESP32-C3``), for a
 * Pico the chip (``rp2040``); the manifest keys on the same strings.
 */
export function selectBuild(
  manifest: FirmwareManifest,
  chipFamily: string
): FirmwareManifestBuild | undefined {
  const target = chipFamily.toLowerCase();
  return manifest.builds.find((b) => b.chipFamily.toLowerCase() === target);
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

/** Forget the cached manifest and UF2 images (tests). */
export function resetEsphomeWebManifest(): void {
  manifest = undefined;
  uf2Cache.clear();
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

/**
 * The manifest publishes no image for ``key``, or the chip could not be
 * told, so there is no key. ``label`` names the chip for the user, absent
 * when it is not known.
 */
export class PublishedImageUnavailableError extends Error {
  constructor(
    readonly key: string | undefined,
    readonly label: string | undefined = key
  ) {
    super(`No ESPHome Web image for the ${label ?? "unknown chip"}`);
    this.name = "PublishedImageUnavailableError";
  }
}

/** Those of ``keys`` the manifest lists a build for, in their order. */
export function publishedKeys<K extends string>(
  manifest: FirmwareManifest,
  keys: readonly K[]
): K[] {
  return keys.filter((key) => selectBuild(manifest, key));
}

/** A published UF2's path under the prefix for the manifest's version. */
const publishedUf2Path = (manifest: FirmwareManifest, key: string): string =>
  `${manifest.version}/esphome-web-${key.toLowerCase()}.uf2`;

/** A published UF2's download URL for the manifest's version. */
export const publishedUf2Url = (manifest: FirmwareManifest, key: string): string =>
  `${ESPHOME_WEB_FIRMWARE_PREFIX}/${publishedUf2Path(manifest, key)}`;

// A reopen, or a switch back to an image already fetched, downloads nothing.
const uf2Cache = new KeyedPromiseCache<Uint8Array>();

/**
 * The bytes of the UF2 ``manifest`` publishes for ``key``. Throws
 * ``PublishedImageUnavailableError`` without downloading when it lists
 * none, otherwise with the reason.
 */
export function fetchPublishedUf2(
  manifest: FirmwareManifest,
  key: string,
  label = key
): Promise<Uint8Array> {
  if (!selectBuild(manifest, key)) {
    return Promise.reject(new PublishedImageUnavailableError(key, label));
  }
  return uf2Cache.fetch(`${manifest.version}/${key.toLowerCase()}`, () =>
    fetchFirmwareFile(publishedUf2Path(manifest, key))
  );
}
