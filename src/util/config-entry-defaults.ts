/**
 * Construct a ``ConfigEntry`` with all required fields populated to
 * neutral defaults plus caller-supplied overrides.
 *
 * ``ConfigEntry`` has many required fields (no ``?:`` optionals). Code
 * that synthesises an entry — whether a test fixture or a production
 * code path that needs to render an entry the catalog didn't ship
 * (e.g. the ``substitutions`` section's user-keyed map) — would
 * otherwise either spell every field out at the callsite or silently
 * cast a ``Partial<ConfigEntry>`` past the type-checker. Both paths
 * drift; this helper keeps one source of truth so adding a field to
 * ``ConfigEntry`` lights up here and only here. (Avoiding a hardcoded
 * field count in this comment because that count itself drifts
 * every time we add a field — the type definition is the source
 * of truth.)
 *
 * Defaults are deliberately neutral (``STRING``, not required, no
 * options/range/etc.) — every callsite that needs a different shape
 * passes the relevant overrides.
 */
import { ConfigEntryType, type ConfigEntry } from "../api/types.js";

export function makeConfigEntry(overrides: Partial<ConfigEntry> = {}): ConfigEntry {
  return {
    key: "",
    type: ConfigEntryType.STRING,
    label: "",
    default_value: null,
    required: false,
    description: null,
    options: null,
    allow_custom_value: false,
    range: null,
    display_format: null,
    unit_options: null,
    help_link: null,
    multi_value: false,
    hidden: false,
    advanced: false,
    translation_key: null,
    translation_params: null,
    templatable: false,
    depends_on: null,
    depends_on_value: null,
    depends_on_value_not: null,
    depends_on_component: null,
    references_component: null,
    pin_features: [],
    pin_mode: null,
    locked: false,
    suggestions: null,
    config_entries: null,
    platform_type: null,
    supported_platforms: undefined,
    ...overrides,
  };
}
