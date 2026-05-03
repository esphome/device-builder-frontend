/**
 * Slugify a user-typed device name into a valid ESPHome ``esphome.name``
 * value.
 *
 * Mirrors upstream ``esphome.helpers.friendly_name_slugify`` exactly so
 * the dashboard's typed-name flows produce the same on-disk filenames
 * the legacy dashboard did:
 *
 * 1. Strip combining diacritics (``é`` → ``e``, ``ü`` → ``u``).
 * 2. Lowercase.
 * 3. Replace spaces and hyphens with underscores.
 * 4. Collapse runs of underscores and trim leading/trailing.
 * 5. Filter to ``[a-z0-9_-]`` (drop everything else).
 * 6. Replace underscores with hyphens.
 *
 * Used for the **typed-name** flows (basic / empty config). Uploaded
 * YAML filenames go through ``safeUploadFilename`` instead — those
 * preserve the user's intent character-for-character where the
 * filesystem allows.
 */
export function friendlyNameSlugify(value: string): string {
  let v = value
    // Strip diacritics: NFD splits ``é`` into ``e`` + combining acute,
    // then drop the combining-mark range.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ /g, "_")
    .replace(/-/g, "_");
  // Collapse runs of underscores, trim ends. Upstream's
  // ``.replace("__", "_")`` is a single non-overlapping pass; the regex
  // here covers 3+-underscore runs in one shot, which matches how
  // multi-word inputs actually round-trip.
  v = v.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  // Filter to ALLOWED_NAME_CHARS = lowercase + digits + ``-`` + ``_``.
  v = v.replace(/[^a-z0-9_-]/g, "");
  return v.replace(/_/g, "-");
}
