// Follows the backend's slugify_hostname (controllers/devices/helpers.py --
// esphome's friendly_name_slugify clamped to the 31-char cap from esphome's
// validate_hostname), but tightened: separator runs collapse to one dash and
// edge dashes are trimmed, where the esphome pipeline can emit 'a--b' or a
// leading dash. Diverging is safe here -- this derives names typed fresh in
// the UI, not the stable adoption-filename mapping -- and the backend re-runs
// its slugifier on the result, for which a clean slug is a fixed point.
export const HOSTNAME_MAX_LEN = 31;

/** Derive a valid esphome.name (mDNS hostname) slug from a display name. */
export function slugifyHostname(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, HOSTNAME_MAX_LEN).replace(/-+$/, "");
}
