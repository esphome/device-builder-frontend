/**
 * Re-export of the production ``makeConfigEntry`` factory for test
 * fixtures. Kept under ``test/util/`` (vitest's ``include`` glob is
 * ``test/**\/*.test.ts`` so this file isn't picked up as a no-test
 * file) so existing imports keep working; the actual logic lives at
 * ``src/util/config-entry-defaults.ts`` so production callsites that
 * synthesise an entry — currently the ``substitutions:`` section —
 * share one source of truth with the test fixtures.
 */
import { ConfigEntryType, type ConfigEntry } from "../../src/api/types/config-entries.js";
import { makeConfigEntry } from "../../src/util/config-entry-defaults.js";

export { makeConfigEntry };

/** A `nested`-typed entry wrapping *children* — the shape schema groups
 *  (`api.encryption`, `esp32.framework`) hydrate as. */
export function makeNestedEntry(key: string, children: ConfigEntry[]): ConfigEntry {
  return makeConfigEntry({ key, type: ConfigEntryType.NESTED, config_entries: children });
}
