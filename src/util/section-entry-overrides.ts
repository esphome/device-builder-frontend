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
import { type ConfigEntry, ConfigEntryType } from "../api/types/config-entries.js";
import { makeConfigEntry } from "./config-entry-defaults.js";

/** Top-level YAML keys whose entire body is a user-keyed map.
 *  Values can be any YAML shape — ``renderMapField`` handles
 *  primitives via the value template and falls back to a per-row
 *  "edit in YAML" placeholder for non-primitives (verified by
 *  ``test/components/device/render-map-field.test.ts``), so the YAML
 *  still round-trips losslessly.
 *
 *  ``packages:`` was previously routed through here so the user
 *  could add / rename / delete package keys from the form, but
 *  upstream also accepts the list shape ``packages: [pkg, pkg]``
 *  (the form the bare-single-package deprecation steers users to,
 *  per ``esphome/components/packages/__init__.py:137``). The
 *  dict-only ``renderMapField`` silently overwrote a list-shaped
 *  YAML with ``{}`` on save (#361), so packages now goes through
 *  ``YAML_ONLY_SECTIONS`` instead — both shapes round-trip via
 *  the YAML pane. */
export const MAP_SECTIONS: ReadonlySet<string> = new Set(["substitutions"]);

/** Sections that must persist explicit ``""`` values in YAML — i.e.
 *  the user typed a key + cleared the value, treat that as
 *  intentional data instead of "user cleared the field, drop it".
 *  ``substitutions`` is currently the only one: its values are
 *  user-supplied strings, and a cleared value means "this
 *  substitution is intentionally empty". */
export const KEEP_EMPTY_STRING_SECTIONS: ReadonlySet<string> = new Set(["substitutions"]);

/** Synthesised entries shared by every section in :data:`MAP_SECTIONS`
 *  — a single MAP whose value template is a string. The user names
 *  each row's key themselves (the substitution name). The string
 *  template is the primitive-value case; non-primitive values
 *  (lists / dicts) get a per-row "edit in YAML" placeholder via
 *  ``renderMapField`` rather than being forced through the string
 *  template (which would stringify them to ``[object Object]`` and
 *  lose data on save).
 *
 *  Per-row format validation is intentionally NOT done here — the
 *  YAML editor's ``yaml-lint-backend.ts`` already pipes the
 *  document through ``editor/validate_yaml``
 *  (``esphome vscode --ace``) and surfaces ESPHome's actual error
 *  as a red squiggle, so the form's save path delegates to that
 *  same backend lint. Duplicating ESPHome's validators in the
 *  frontend would silently drift the moment upstream's accepted
 *  shape changes. The save path's roundtrip lives in
 *  ``device-section-config``'s ``_onSave``. */
const MAP_SECTION_ENTRIES: ConfigEntry[] = [
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

/** Singular card-header noun per list section; falls back to 'Item'. */
const LIST_SECTION_ITEM_LABELS: Readonly<Record<string, string>> = {
  globals: "Global variable",
};

/**
 * Resolve the entries to render for a section.
 *
 * MAP_SECTIONS get the synthesised map; isList sections get one keyed
 * nested multi_value entry wrapping the catalog fields (value at
 * [sectionKey], like esphome.areas); others pass through unchanged.
 */
export function resolveSectionEntries(
  sectionKey: string,
  catalogEntries: ConfigEntry[],
  isList = false
): ConfigEntry[] {
  if (MAP_SECTIONS.has(sectionKey)) return MAP_SECTION_ENTRIES;
  if (isList) {
    return [
      makeConfigEntry({
        key: sectionKey,
        type: ConfigEntryType.NESTED,
        multi_value: true,
        label: LIST_SECTION_ITEM_LABELS[sectionKey] ?? "Item",
        config_entries: catalogEntries,
      }),
    ];
  }
  return catalogEntries;
}
