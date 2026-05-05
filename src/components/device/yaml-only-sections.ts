/**
 * Top-level keys we always treat as YAML-only regardless of what the
 * backend returns.
 *
 * - `external_components` — accepts two distinct shapes for `source`
 *   (a string shorthand `"local_components"` / `"github://..."` and a
 *   typed-object form `{type: local|git, path|url|ref, ...}`). The
 *   form-driven editor only renders the string shorthand, which means
 *   the typed-object form is invisible and the description for the
 *   inner `type` discriminator gets attached to the outer string field
 *   ("Repository type. One of local, git." — issue #337). The catalog
 *   model can't express a discriminated union, and adding a
 *   YAML-fragment escape hatch per row (the way ``packages`` is
 *   handled via ``MAP_SECTIONS``) doesn't fit either: the user-keyed
 *   shape isn't a map, it's a list of items each with a structured
 *   body. Always YAML-only.
 *
 * `packages` is *not* in this set — see ``MAP_SECTIONS`` for how it
 * gets a partial structured editor (key list with per-row "edit in
 * YAML" placeholders for the structured values). Substitutions /
 * globals / etc. rely on the backend describing them as a MAP entry
 * and fall back to the YAML notice automatically when the schema
 * returns no entries.
 *
 * Lives in its own module rather than alongside the Lit component
 * so unit tests can pin the contract without dragging in Lit / DOM
 * dependencies that aren't available in the vitest Node
 * environment. One source of truth — the component imports from
 * here, the test imports from here.
 */
export const YAML_ONLY_SECTIONS: ReadonlySet<string> = new Set([
  "external_components",
]);

/**
 * Decide whether a section should be rendered as YAML-only.
 *
 * Two paths:
 * 1. The key is in the always-YAML set above.
 * 2. The backend returned no schema entries — there's nothing to
 *    render a structured form for, so fall back to the YAML notice
 *    rather than emit an empty form with just the description.
 */
export function isYamlOnlySection(
  sectionKey: string,
  entryCount: number,
): boolean {
  return YAML_ONLY_SECTIONS.has(sectionKey) || entryCount === 0;
}
