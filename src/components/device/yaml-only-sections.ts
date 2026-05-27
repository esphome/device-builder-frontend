/**
 * Top-level keys always rendered YAML-only.
 *
 * `external_components` accepts both a string-shorthand `source:` and
 * a typed-object `source: {type, path|url|ref, ...}`. The catalog
 * model can't express the discriminated union, so the form editor
 * renders only the string shape and mislabels the field with the
 * inner `type` discriminator's description (issue #337).
 *
 * `packages` accepts THREE shapes upstream
 * (``esphome/components/packages/__init__.py``):
 *   1. A user-keyed dict: ``{name: pkg, name: pkg}``
 *   2. A list of package definitions: ``[pkg, pkg]`` — the form
 *      ``packages: !include x.yaml`` deprecation steers users to.
 *   3. A bare single package definition (deprecated, going away in
 *      ESPHome 2026.7.0).
 * Each value can be an ``!include`` directive, a ``github://`` /
 * ``gitlab://`` source-shorthand string, a typed remote-package
 * object (with ``url`` / ``files`` / ``ref`` / ``vars``), or an
 * inline package contents dict. The catalog model can't express
 * "list-or-dict whose items are a discriminated union", and the
 * dict-only renderer the editor previously used silently
 * overwrote list-shaped configs with ``{}`` on save (issue #361),
 * so route the whole section to YAML-only — both shapes round-
 * trip cleanly through the YAML pane.
 *
 * Lives in its own module so the unit test can import without
 * dragging Lit / DOM into the vitest Node environment.
 */
export const YAML_ONLY_SECTIONS: ReadonlySet<string> = new Set([
  "external_components",
  "packages",
]);

/** True when the section should fall back to the YAML notice — either
 *  always-YAML, or the backend returned no schema entries to render. */
export function isYamlOnlySection(sectionKey: string, entryCount: number): boolean {
  return YAML_ONLY_SECTIONS.has(sectionKey) || entryCount === 0;
}
