import type { ESPHomeAPI } from "../api/index.js";
import type { BoardCatalogEntry } from "../api/types/boards.js";
import { BatchedCache } from "./batched-cache.js";

/** Session-scoped cache of full board bodies, keyed by board id.
 *  ``boards/get_boards`` ships slim picker entries; the full body
 *  (``requires_wifi``, ``pins``, ``featured_*``, ...) comes from
 *  ``boards/get_board``, which is otherwise an uncached
 *  pass-through. Several flows — the create wizard, chip
 *  detection, serial detect, the device editor, firmware install
 *  — each refetched independently. Routing them through here
 *  coalesces concurrent requests for the same id into one round
 *  trip and remembers the body for the process lifetime (the
 *  board catalog is immutable per session).
 *
 *  There is no batch board endpoint, so the fetcher fans a bucket
 *  out to one ``getBoard`` per id. A board id a caller holds
 *  always resolves in a healthy backend, so — like
 *  ``automation-body-cache`` — a null is a contract violation we
 *  don't cache (``cacheMisses: false``); a re-mount can recover
 *  instead of seeing a sticky empty result. */

const _cache = new BatchedCache<BoardCatalogEntry, void>({
  name: "board-body-cache",
  bucketKey: () => "",
  cacheMisses: false,
  fetch: async (api, ids) => {
    const bodies = await Promise.all(
      // Catch per id: the bucket fans out to independent getBoard calls, so one
      // id's transport error must not reject the whole batch (and every innocent
      // waiter with it). A rejected id resolves to null — uncached under
      // ``cacheMisses: false``, so the caller recovers on re-fetch.
      ids.map((id) =>
        api.getBoard(id).then(
          (board) => [id, board] as const,
          (err): readonly [string, BoardCatalogEntry | null] => {
            console.warn(`Failed to load board body ${id}:`, err);
            return [id, null];
          }
        )
      )
    );
    // Null-prototype accumulator so a board id like ``__proto__`` can't reach
    // the Object prototype through the ``record[id]`` write.
    const record: Record<string, BoardCatalogEntry> = Object.create(null);
    for (const [id, board] of bodies) {
      // Omit misses so ``cacheMisses: false`` leaves them recoverable.
      if (board !== null) record[id] = board;
    }
    return record;
  },
});

/** Synchronous cache read. ``cacheMisses: false`` means a null is
 *  never persisted, so the return is ``BoardCatalogEntry | undefined``. */
export function getCachedBoard(boardId: string): BoardCatalogEntry | undefined {
  return _cache.getCached(boardId, undefined) ?? undefined;
}

export function fetchBoard(
  api: ESPHomeAPI,
  boardId: string
): Promise<BoardCatalogEntry | null> {
  return _cache.fetch(api, boardId, undefined);
}

export function _clearBoardBodyCache(): void {
  _cache.clear();
}
