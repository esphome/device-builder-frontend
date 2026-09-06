/** Ordering for ESPHome `YYYY.M[.P][suffix]` versions; a suffix orders below its release. */

const VERSION_RE = /^(\d+)\.(\d+)(?:\.(\d+))?(.*)$/;

function parse(version: string): [number, number, number, number] | null {
  const match = VERSION_RE.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0), match[4] ? 0 : 1];
}

/** A final `YYYY.M[.P]` release: not a beta, rc, or dev build. */
export function isReleaseVersion(version: string): boolean {
  return /^\d+\.\d+(?:\.\d+)?$/.test(version.trim());
}

/** Whether `version` orders at or after `minimum`; `false` when either isn't a version. */
export function versionAtLeast(version: string, minimum: string): boolean {
  const a = parse(version);
  const b = parse(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

/** First esphome whose firmware offers OTA encryption with the api key (esphome/esphome#18979). */
export const OTA_ENCRYPTION_OFFER_VERSION = "2026.9.0";

/** Whether firmware at `deployed` offers OTA encryption: a released 2026.9.0 or newer. */
export function firmwareOffersOtaEncryption(deployed: string): boolean {
  return (
    isReleaseVersion(deployed) && versionAtLeast(deployed, OTA_ENCRYPTION_OFFER_VERSION)
  );
}

/** Whether the dashboard's own esphome accepts `ota: encryption:` inheriting the api key. */
export function toolchainAcceptsOtaEncryption(esphomeVersion: string): boolean {
  return versionAtLeast(esphomeVersion, OTA_ENCRYPTION_OFFER_VERSION);
}
