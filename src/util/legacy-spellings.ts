/**
 * Session store of accepted key spellings, seeded once from the
 * catalog's renamed_to marks (components/get_legacy_spellings) at the
 * device editor's load gate. The catalog is immutable per backend
 * process, so after seeding the store never changes and consumers read
 * it synchronously with no invalidation concerns.
 */

import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { LegacySpellingRow } from "../api/types/components.js";

const _spellings = new Map<string, readonly string[]>();
let _loadPromise: Promise<void> | null = null;

const _key = (componentId: string, path: readonly string[]): string =>
  `${componentId}|${path.join("|")}`;

/** Accepted spellings of the entry at canonical path, canonical first. */
export function acceptedKeysFor(
  componentId: string,
  path: readonly string[]
): readonly string[] {
  return _spellings.get(_key(componentId, path)) ?? [path[path.length - 1]];
}

/** Store a get_legacy_spellings payload. */
export function seedLegacySpellings(payload: Record<string, LegacySpellingRow[]>): void {
  for (const [componentId, rows] of Object.entries(payload)) {
    for (const row of rows) {
      _spellings.set(_key(componentId, row.path), row.spellings);
    }
  }
}

/** Fetch and seed once per session; never rejects (canonical-only degrade). */
export function loadLegacySpellings(api: ESPHomeAPI): Promise<void> {
  _loadPromise ??= (async () => {
    try {
      seedLegacySpellings(await api.getLegacySpellings());
    } catch (err) {
      console.warn("[legacy-spellings] load failed; canonical keys only:", err);
    }
  })();
  return _loadPromise;
}

/** Test helper: drop the store and the session load memo. */
export function _clearLegacySpellings(): void {
  _spellings.clear();
  _loadPromise = null;
}
