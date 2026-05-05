/**
 * Top-level keys always rendered YAML-only.
 *
 * `external_components` accepts both a string-shorthand `source:` and
 * a typed-object `source: {type, path|url|ref, ...}`. The catalog
 * model can't express the discriminated union, so the form editor
 * renders only the string shape and mislabels the field with the
 * inner `type` discriminator's description (issue #337). `packages`
 * is *not* here — it goes through ``MAP_SECTIONS`` instead.
 *
 * Lives in its own module so the unit test can import without
 * dragging Lit / DOM into the vitest Node environment.
 */
export const YAML_ONLY_SECTIONS: ReadonlySet<string> = new Set([
  "external_components",
]);

/** True when the section should fall back to the YAML notice — either
 *  always-YAML, or the backend returned no schema entries to render. */
export function isYamlOnlySection(
  sectionKey: string,
  entryCount: number,
): boolean {
  return YAML_ONLY_SECTIONS.has(sectionKey) || entryCount === 0;
}
