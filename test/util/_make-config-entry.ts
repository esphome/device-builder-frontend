/**
 * Re-export of the production ``makeConfigEntry`` factory for test
 * fixtures. Kept under ``test/util/`` (vitest's ``include`` glob is
 * ``test/**\/*.test.ts`` so this file isn't picked up as a no-test
 * file) so existing imports keep working; the actual logic lives at
 * ``src/util/config-entry-defaults.ts`` so production callsites that
 * synthesise an entry — currently the ``substitutions:`` section —
 * share one source of truth with the test fixtures.
 */
export { makeConfigEntry } from "../../src/util/config-entry-defaults.js";
