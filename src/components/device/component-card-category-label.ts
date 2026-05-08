/**
 * Compute the singular display label for a catalog entry's
 * category, suitable for the card-level chip that
 * disambiguates same-name entries from different platforms
 * (e.g. ``sensor.debug`` vs ``text_sensor.debug``, both
 * carrying the upstream ``Debug Component`` name).
 *
 * Derived deterministically from the category id rather than a
 * translation table: maintaining N×locales chip labels for every
 * possible category drifts as new categories ship from the
 * sync script. Title-cases tokens, swallows the underscore
 * separator, and uppercases a small set of well-known
 * acronyms inline so ``audio_adc`` doesn't render as
 * "Audio Adc" and ``ota`` doesn't render as "Ota". The acronym
 * set is intentionally short — adding one is cheaper than
 * pulling in i18n for a chip — and only covers tokens that
 * appear as category-id components today (see
 * ``ComponentCategory`` in ``api/types.ts``).
 *
 * Lives in its own module so the title-casing + acronym
 * handling can be unit-tested without spinning up a DOM env to
 * render the card.
 */

const ACRONYMS = new Set([
  "adc",
  "dac",
  "ota",
]);

export function categoryChipLabel(category: string): string {
  if (!category) return "";
  return category
    .split("_")
    .filter((word) => word.length > 0)
    .map((word) => {
      if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase();
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(" ");
}
