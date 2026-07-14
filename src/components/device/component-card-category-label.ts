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

const ACRONYMS = new Set(["adc", "dac", "ota"]);

export function categoryChipLabel(category: string): string {
  if (!category) return "";
  // The synthetic board-recommendation category is the one id whose
  // display word diverges from its wire id: every other surface
  // (sidebar row, wizard copy) says "Recommended" (#1220).
  if (category === "featured") return "Recommended";
  return category
    .split("_")
    .filter((word) => word.length > 0)
    .map((word) => {
      if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase();
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Upper-case the platform stem of a catalog id (the part after the
 * domain in ``<domain>.<stem>``) so two entries that share a name
 * within one category stay distinguishable — ``stepper.a4988`` and
 * ``stepper.uln2003`` both carry the name "Stepper Component", and the
 * category chip can't separate them. Every colliding stem is a part
 * number or bus token (a4988, uln2003, lcd_gpio, bmp581_i2c), so full
 * upper-case reads right ("ULN2003", "BMP581 I2C") where title-casing
 * would mangle it ("Uln2003"). Returns "" for an id with no stem.
 */
export function platformLabel(id: string): string {
  const dot = id.indexOf(".");
  if (dot === -1) return "";
  return id
    .slice(dot + 1)
    .split("_")
    .filter((word) => word.length > 0)
    .map((word) => word.toUpperCase())
    .join(" ");
}

/**
 * Compose the Add-Component dialog header for a selected entry,
 * appending the category label so same-name entries from
 * different categories stay distinguishable once the form view
 * drops the card chip. Same-domain collisions (stepper.a4988 /
 * stepper.uln2003) share a category, so the header stays
 * identical there — the grid's platformLabel chip disambiguates
 * those, and the user has already picked the right card by the
 * time the form opens. The core-config flow keeps the bare name:
 * its components are unique top-level domains with no same-name
 * collisions, where a "Wi-Fi · Wifi" suffix would be pure
 * redundancy.
 */
export function componentDialogTitle(
  name: string,
  category: string,
  opts: { core: boolean }
): string {
  if (opts.core) return name;
  const label = categoryChipLabel(category);
  return label ? `${name} · ${label}` : name;
}

/**
 * Whether the catalog card should render the category chip
 * given the current sidebar filter. Only useful under the
 * "All" filter where the category VARIES across visible
 * results — once the user has narrowed to a specific category
 * (Sensors / Switches / ...) every card carries the same
 * chip, which is pure noise.
 *
 * The "Recommended" / "featured" sidebar entry intentionally
 * shows the chip too: featured cards are surfaced from
 * different real categories (a featured sensor + a featured
 * switch + ...) so the disambiguator still earns its place.
 *
 * Only the explicit single-category narrow case suppresses
 * the chip.
 */
export function shouldShowCategoryChip(sidebarFilter: string): boolean {
  return sidebarFilter === "all" || sidebarFilter === "featured";
}
