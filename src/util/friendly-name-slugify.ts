/**
 * Slugify a user-typed device name into a valid ESPHome ``esphome.name``
 * value.
 *
 * Closely follows upstream ``esphome.helpers.friendly_name_slugify``:
 *
 * 1. Strip combining diacritics (``é`` → ``e``, ``ü`` → ``u``).
 * 2. Lowercase.
 * 3. Replace spaces and hyphens with underscores.
 * 4. Collapse runs of underscores and trim leading/trailing.
 * 5. Filter to ``[a-z0-9_-]`` (drop everything else).
 * 6. Replace underscores with hyphens.
 *
 * One deliberate divergence from upstream is the underscore collapse —
 * see the comment at the implementation site. Every other step
 * matches upstream byte-for-byte, so the slugs the legacy dashboard
 * would have produced for previously-imported devices still match
 * the on-disk filenames.
 *
 * Used for the **typed-name** flows (basic / empty config). Uploaded
 * YAML filenames go through ``safeUploadFilename`` instead — those
 * preserve the user's intent character-for-character where the
 * filesystem allows.
 */
export function friendlyNameSlugify(value: string): string {
  let v = value
    // Strip diacritics: NFD splits ``é`` into ``e`` + combining acute,
    // then drop the U+0300..U+036F combining-mark range. Use the
    // escaped form rather than literal combining characters in the
    // regex so the source survives editor / normalizer round-trips
    // and reads cleanly in review.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ /g, "_")
    .replace(/-/g, "_");
  // Collapse runs of underscores, then trim ends. **Deliberate
  // divergence from upstream** here: upstream's
  // ``.replace("__", "_")`` is a single non-overlapping pass, so
  // ``____`` collapses to ``__`` and the final slug ends up with
  // doubled separators (``"a    b"`` → ``"a--b"``). Our ``/_+/g``
  // regex collapses any run to one ``_`` in a single pass, so
  // ``"a    b"`` slugs cleanly to ``"a-b"``. The divergence is
  // user-visible but only on inputs that the legacy dashboard
  // would also have rendered awkwardly — existing on-disk
  // filenames are unaffected (they were already legal slugs).
  v = v.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  // Filter to ALLOWED_NAME_CHARS = lowercase + digits + ``-`` + ``_``.
  v = v.replace(/[^a-z0-9_-]/g, "");
  return v.replace(/_/g, "-");
}
