// Mirrors the backend's slugify_hostname (controllers/devices/helpers.py):
// esphome's friendly_name_slugify clamped to the 31-char hostname cap from
// esphome's validate_hostname. Keep the steps in sync with both, in order --
// the derived value is sent verbatim as the clone's esphome.name.
export const HOSTNAME_MAX_LEN = 31;

/** Derive a valid esphome.name (mDNS hostname) slug from a display name. */
export function slugifyHostname(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replaceAll(" ", "_")
    .replaceAll("-", "_")
    .replaceAll("__", "_")
    .replace(/^_+|_+$/g, "")
    .replace(/[^a-z0-9_-]/g, "")
    .replaceAll("_", "-");
  return slug.slice(0, HOSTNAME_MAX_LEN).replace(/-+$/, "");
}
