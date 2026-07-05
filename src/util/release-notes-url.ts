import { deviceBuilderChannel } from "./device-builder-channel.js";

/**
 * Release-notes URL for a Device Builder version, or null for a dev build
 * (which has no published tag). The release tag is the trimmed version with
 * any leading v removed.
 */
export function deviceBuilderReleaseUrl(version: string): string | null {
  if (deviceBuilderChannel(version) === "dev") return null;
  const v = version.trim().replace(/^v/, "");
  return `https://github.com/esphome/device-builder/releases/tag/${v}`;
}

/** Docs URL for the ESPHome Desktop app (fixed; not per-version). */
export function desktopDocsUrl(): string {
  return "https://desktop.esphome.io/";
}

/**
 * Docs URL for an ESPHome version, routed by channel. Stable links to the
 * per-minor changelog on esphome.io; patch and pre-release versions normalize
 * to the YYYY.M.0 page (e.g. 2026.6.3 and 2026.6.0b3 both map to 2026.6.0).
 * Beta (bN) uses the beta docs site, whose page exists before the stable one.
 * A dev build links to the next docs root, since its changelog is unpublished.
 * Returns null when the version cannot be parsed.
 */
export function esphomeChangelogUrl(version: string): string | null {
  const v = version.trim();
  if (/dev/i.test(v)) return "https://next.esphome.io/";
  const m = v.match(/^(\d{4})\.(\d{1,2})\b/);
  if (!m) return null;
  const host = /b\d/.test(v) ? "beta.esphome.io" : "esphome.io";
  return `https://${host}/changelog/${m[1]}.${m[2]}.0/`;
}
