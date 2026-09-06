/**
 * Ordered comparison of ESPHome version strings, for gating features
 * on the firmware a device runs or the esphome the dashboard bundles.
 * Understands the shapes esphome emits: `2026.9.0`, `2026.9.0b2`,
 * `2026.9.0rc1`, `2026.10.0-dev` / `2026.10.0.dev0`. A pre-release or
 * dev build orders below the final release of its own line.
 */

const VERSION_RE =
  /^v?(\d+(?:\.\d+)*)(?:[-_.]?(a|alpha|b|beta|rc|c|pre|preview)[-_.]?(\d*))?(?:[-_.]?(dev)[-_.]?(\d*))?(?:\+.*)?$/i;

const PRE_ORDER: Record<string, number> = {
  a: 0,
  alpha: 0,
  b: 1,
  beta: 1,
  c: 2,
  pre: 2,
  preview: 2,
  rc: 2,
};

interface ParsedVersion {
  release: number[];
  /** `[kind, number]`; a final release sorts after every pre-release. */
  pre: [number, number];
  /** Dev builds sort before everything else at the same release + pre. */
  dev: number;
}

function parse(version: string): ParsedVersion | null {
  const match = VERSION_RE.exec(version.trim());
  if (!match) return null;
  const release = match[1].split(".").map(Number);
  while (release.length > 1 && release[release.length - 1] === 0) release.pop();
  const dev = match[4] ? Number(match[5] || 0) : Number.POSITIVE_INFINITY;
  // A bare dev build (`2026.9.0.dev0`) orders before that line's pre-releases.
  const pre: [number, number] = match[2]
    ? [PRE_ORDER[match[2].toLowerCase()], Number(match[3] || 0)]
    : [match[4] ? -1 : 3, 0];
  return { release, pre, dev };
}

/** Plain dotted numerals only: a final release, not a beta, rc, or dev build. */
export function isReleaseVersion(version: string): boolean {
  return /^\d+(?:\.\d+)*$/.test(version.trim());
}

/**
 * `-1`, `0`, or `1` ordering `a` against `b`; `null` when either side
 * isn't an esphome version.
 */
export function compareEsphomeVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  const width = Math.max(pa.release.length, pb.release.length);
  for (let i = 0; i < width; i++) {
    const diff = (pa.release[i] ?? 0) - (pb.release[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  for (let i = 0; i < 2; i++) {
    const diff = pa.pre[i] - pb.pre[i];
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (pa.dev === pb.dev) return 0;
  return pa.dev < pb.dev ? -1 : 1;
}

/** First esphome whose firmware offers OTA encryption with the api key. */
export const OTA_ENCRYPTION_OFFER_VERSION = "2026.9.0";

/**
 * Whether firmware at `deployed` offers OTA encryption with its api key:
 * a released 2026.9.0 or newer. Betas and dev builds are excluded, so
 * the nudge never proposes a block the running firmware can't serve.
 */
export function firmwareOffersOtaEncryption(deployed: string): boolean {
  return (
    isReleaseVersion(deployed) &&
    (compareEsphomeVersions(deployed, OTA_ENCRYPTION_OFFER_VERSION) ?? -1) >= 0
  );
}

/** Whether the dashboard's own esphome accepts `ota: encryption:` inheriting the api key. */
export function toolchainAcceptsOtaEncryption(esphomeVersion: string): boolean {
  return (
    (compareEsphomeVersions(esphomeVersion, OTA_ENCRYPTION_OFFER_VERSION) ?? -1) >= 0
  );
}
