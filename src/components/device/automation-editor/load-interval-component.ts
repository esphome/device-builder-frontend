/**
 * Lazy fetch of the ``interval`` component catalog entry. Reuses the
 * shared component-name cache so the navigator's pre-fetch (for the
 * label) doubles as the editor's source. Resolves ``null`` when no
 * catalog entry is available or the fetch fails — the editor falls
 * back to the static label; transient backend hiccups shouldn't
 * surface as an error here.
 */
import type { ESPHomeAPI } from "../../../api/index.js";
import type { ComponentCatalogEntry } from "../../../api/types/components.js";
import {
  fetchComponent,
  getCachedComponent,
} from "../../../util/component-name-cache.js";

export async function loadIntervalComponent(
  api: ESPHomeAPI,
  platform: string | undefined,
  boardId: string | undefined
): Promise<ComponentCatalogEntry | null> {
  const cached = getCachedComponent(`interval`, platform, boardId);
  if (cached) return cached;
  try {
    return (await fetchComponent(api, `interval`, platform, boardId)) ?? null;
  } catch {
    return null;
  }
}
