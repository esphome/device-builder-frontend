import { deviceBuilderChannel } from "./device-builder-channel.js";

/**
 * Release-notes URL for a Device Builder version, or null for a dev build
 * (which has no published tag). The release tag is the version verbatim.
 */
export function deviceBuilderReleaseUrl(version: string): string | null {
  if (deviceBuilderChannel(version) === "dev") return null;
  const v = version.trim().replace(/^v/, "");
  return `https://github.com/esphome/device-builder/releases/tag/${v}`;
}

/**
 * Changelog URL for an ESPHome version, or null for a dev build. ESPHome
 * publishes one page per minor; patch and pre-release versions normalize to
 * the YYYY.M.0 page (e.g. 2026.5.3 and 2026.5.0b1 both map to 2026.5.0).
 */
export function esphomeChangelogUrl(version: string): string | null {
  const v = version.trim();
  if (/dev/i.test(v)) return null;
  const m = v.match(/^(\d{4})\.(\d{1,2})\b/);
  return m ? `https://esphome.io/changelog/${m[1]}.${m[2]}.0/` : null;
}
