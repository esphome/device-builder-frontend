import { ConfigEntryType, type ConfigEntry } from "../../src/api/types.js";

/**
 * Build a `ConfigEntry` test fixture with sensible defaults plus
 * caller-provided overrides.
 *
 * Lives outside the `*.test.ts` glob (vitest's `include` pattern is
 * `test/**\/*.test.ts`) so it isn't picked up as a no-test file. The
 * underscore-prefix in the filename signals "shared helper" to anyone
 * scanning the directory.
 *
 * Field defaults are deliberately neutral (STRING, not required, no
 * options/range) — every test that needs a different shape passes
 * the relevant override, so a new field on `ConfigEntry` only needs
 * to be threaded through this one helper to keep tsc happy.
 */
export function makeConfigEntry(
  overrides: Partial<ConfigEntry> = {},
): ConfigEntry {
  return {
    key: "foo",
    type: ConfigEntryType.STRING,
    label: "Foo",
    default_value: null,
    required: false,
    description: null,
    options: null,
    allow_custom_value: false,
    range: null,
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
    ...overrides,
  };
}
