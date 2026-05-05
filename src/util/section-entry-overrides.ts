/**
 * Frontend overrides for top-level YAML sections whose backend
 * catalog ``config_entries`` don't match the actual user-keyed
 * shape ESPHome accepts.
 *
 * Tracked upstream: ``script/sync_components.py`` only honours the
 * schema's ``key_type`` annotation at the *field* level, not at the
 * component-CONFIG_SCHEMA level — so a component like
 * ``substitutions:`` (whose CONFIG_SCHEMA is itself a user-keyed
 * map) ships with one bogus ``string`` entry rather than the MAP
 * shape the renderer expects. Override here so the visual editor
 * draws the right control.
 *
 * Pure logic (no Lit / no DOM) so the resolution is unit-testable
 * directly — a previous version of this fix had the override
 * variable defined but the form's ``.entries`` prop still bound
 * to ``this._config.entries``, leaving the section silently empty.
 * ``resolveSectionEntries`` is the seam the test asserts against.
 */
import { ConfigEntryType, type ConfigEntry } from "../api/types.js";
import { makeConfigEntry } from "./config-entry-defaults.js";

/** Top-level YAML keys whose entire body is a user-keyed map.
 *  Values can be any YAML shape — ``renderMapField`` handles
 *  primitives via the value template and falls back to a per-row
 *  "edit in YAML" placeholder for non-primitives (verified by
 *  ``test/components/device/render-map-field.test.ts``), so the YAML
 *  still round-trips losslessly. ``packages:`` rides this same path
 *  so the user can at least add / rename / delete package keys from
 *  the form even though each value's structured body falls through
 *  to the per-row YAML placeholder. */
export const MAP_SECTIONS: ReadonlySet<string> = new Set([
  "substitutions",
  "packages",
]);

/** Sections that must persist explicit ``""`` values in YAML — i.e.
 *  the user typed a key + cleared the value, treat that as
 *  intentional data instead of "user cleared the field, drop it".
 *  Distinct from :data:`MAP_SECTIONS` because the empty-string
 *  invariant is a substitutions-specific contract: substitutions
 *  values are user-supplied strings (a cleared value means "this
 *  substitution is intentionally empty"), whereas ``packages``
 *  values are nested package mappings — a top-level empty-string
 *  there is just a placeholder from ``renderMapField`` that the
 *  user hasn't filled in yet. ``packages: { new_1: "" }`` is
 *  syntactically valid YAML but ESPHome's ``packages:`` schema
 *  rejects an empty-string package definition, so persisting it
 *  produces a config that fails validation. */
export const KEEP_EMPTY_STRING_SECTIONS: ReadonlySet<string> = new Set([
  "substitutions",
]);

/** Mirror of ESPHome's ``GitFile.from_shorthand`` regex (esphome/git.py)
 *  pinned to the supported domains. Anchored end-to-end so the form
 *  rejects values with whitespace, missing protocol, or unsupported
 *  domain *before* save instead of round-tripping a config that
 *  ESPHome's loader will reject at compile time. Mirrors upstream;
 *  any ESPHome-side change to accepted shorthand should land here
 *  too. */
const PACKAGES_SOURCE_PATTERN =
  "^(github|gitlab):\\/\\/[A-Za-z0-9\\-]+\\/[A-Za-z0-9._\\-]+\\/[A-Za-z0-9._\\/-]+(@[A-Za-z0-9._\\/-]+)?(\\?[A-Za-z0-9._\\/-]+)?$";

/** Synthesised value template shared by every user-keyed-MAP section.
 *  Most sections (``substitutions:`` and any future addition) accept
 *  arbitrary string values, so this is the neutral default — a
 *  required string with no pattern. Sections that need a stricter
 *  shape (``packages:``) override the template via
 *  :data:`SECTION_VALUE_TEMPLATE_OVERRIDES` below. */
const DEFAULT_VALUE_TEMPLATE = makeConfigEntry({
  key: "value",
  label: "Value",
  required: true,
});

/** Per-section value-template overrides. Anything not in this map
 *  uses :data:`DEFAULT_VALUE_TEMPLATE`. Kept as a Map so callers can
 *  iterate the configured sections (tests do this) without spreading
 *  an object's enumerable own keys. */
const SECTION_VALUE_TEMPLATE_OVERRIDES: ReadonlyMap<string, ConfigEntry> =
  new Map([
    [
      "packages",
      makeConfigEntry({
        key: "value",
        label: "Source",
        required: true,
        pattern: PACKAGES_SOURCE_PATTERN,
        pattern_error: "validation.invalid_package_source",
      }),
    ],
  ]);

/** Cache of synthesised entries per section key. Cached because the
 *  form's ``.entries`` prop is referentially compared on each render
 *  cycle — building a fresh array each call would re-mount the rows
 *  every keystroke. Populated lazily on the first
 *  :func:`resolveSectionEntries` call per section key. */
const SECTION_ENTRIES_CACHE = new Map<string, ConfigEntry[]>();

/**
 * Pick the right ``ConfigEntry[]`` to render for *sectionKey*.
 *
 * For sections in ``MAP_SECTIONS`` returns a single user-keyed-MAP
 * entry whose value template comes from
 * :data:`SECTION_VALUE_TEMPLATE_OVERRIDES` (when configured) or
 * :data:`DEFAULT_VALUE_TEMPLATE` (otherwise). Non-MAP sections hand
 * the catalog entries back unchanged. Pure (cached internally, so
 * identical sectionKey returns the same reference) — the render
 * path's correctness is testable without standing up a shadow
 * root, and the form's ``.entries`` prop reference is stable
 * across renders. (Previously the override variable existed but
 * the form's ``.entries`` prop bound to the wrong source, leaving
 * the section silently empty; pinning the resolution as a function
 * the tests call directly closes that loophole.)
 */
export function resolveSectionEntries(
  sectionKey: string,
  catalogEntries: ConfigEntry[],
): ConfigEntry[] {
  if (!MAP_SECTIONS.has(sectionKey)) return catalogEntries;
  let cached = SECTION_ENTRIES_CACHE.get(sectionKey);
  if (!cached) {
    const valueTemplate =
      SECTION_VALUE_TEMPLATE_OVERRIDES.get(sectionKey) ??
      DEFAULT_VALUE_TEMPLATE;
    cached = [
      makeConfigEntry({
        type: ConfigEntryType.MAP,
        config_entries: [valueTemplate],
      }),
    ];
    SECTION_ENTRIES_CACHE.set(sectionKey, cached);
  }
  return cached;
}
