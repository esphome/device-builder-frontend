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

/** Synthesised entries for ``substitutions:`` — a single MAP whose
 *  value template is a string. The user names each row's key
 *  themselves (the substitution name). The string template is the
 *  primitive-value case; non-primitive values (lists / dicts) get a
 *  per-row "edit in YAML" placeholder via ``renderMapField`` rather
 *  than being forced through the string template (which would
 *  stringify them to ``[object Object]`` and lose data on save).
 *  Built via ``makeConfigEntry`` so all 28 required ``ConfigEntry``
 *  fields are populated. */
export const SUBSTITUTIONS_ENTRIES: ConfigEntry[] = [
  makeConfigEntry({
    type: ConfigEntryType.MAP,
    config_entries: [
      makeConfigEntry({
        key: "value",
        label: "Value",
        required: true,
      }),
    ],
  }),
];

/**
 * Pick the right ``ConfigEntry[]`` to render for *sectionKey*.
 *
 * For sections in ``MAP_SECTIONS`` returns the synthesised MAP
 * shape; otherwise hands back the catalog entries unchanged. Pure
 * function — same input, same output, no side effects — so the
 * render path's correctness is testable without standing up a
 * shadow root. (Previously the override variable existed but the
 * form's ``.entries`` prop bound to the wrong source, leaving the
 * section silently empty; pinning the resolution as a function the
 * tests call directly closes that loophole.)
 */
export function resolveSectionEntries(
  sectionKey: string,
  catalogEntries: ConfigEntry[],
): ConfigEntry[] {
  if (MAP_SECTIONS.has(sectionKey)) return SUBSTITUTIONS_ENTRIES;
  return catalogEntries;
}
