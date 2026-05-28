import type { ESPHomeAPI } from "../../api/index.js";
import type { ComponentCatalogEntry } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { fetchComponent } from "../../util/component-name-cache.js";

/**
 * Slice of ``ESPHomeAddComponentDialog`` state ``hydrateForSelection`` reads.
 * Mirrors the host-narrowing shape used by ``navigateToDep`` so the
 * dialog stays a small surface against this helper.
 *
 * ``_selectionSeq`` is the monotonic token guarding async
 * hydrations against stale-response races. The helper bumps it
 * before each await and checks it after, so a slower earlier
 * click can't write back over a faster later one. The caller
 * does NOT need to bump it; the helper owns the lifecycle.
 */
export interface SelectionHost {
  readonly _api: ESPHomeAPI;
  platform: string;
  board: { id: string } | null;
  _selectionSeq: number;
  readonly _localize: LocalizeFunc;
}

/** Result of an attempted selection hydration. ``stale`` means the
 *  caller should NOT mutate any state (a newer selection bumped
 *  the seq while we were awaiting). ``ok`` carries the resolved
 *  body. ``error`` carries the message the caller should surface
 *  in the submit-error banner. */
export type SelectionResult =
  | { kind: "stale" }
  | { kind: "ok"; entry: ComponentCatalogEntry }
  | { kind: "error"; message: string };

/**
 * Hydrate a slim catalog id to its full body, guarded by the
 * host's selection token.
 *
 * The catalog list endpoint returns slim ``ComponentCatalogIndexEntry``
 * shapes (no ``config_entries``); the dialog's form needs the full
 * body to render its fields. Hydrate goes through ``fetchComponent``
 * so the cached + microtask-batched path applies. A ``boardId``
 * override is honoured for the featured-bundle path which knows
 * the bundle's board explicitly; otherwise the host's current
 * board wins.
 *
 * Mutation of caller state (``_selected`` / ``_submitError`` /
 * bundle progress) intentionally lives in the caller so the
 * "stale -> noop" path is one place to read. This closes the
 * race the prior shape had: it used to set ``_submitError``
 * before the caller had a chance to check the token, so a stale
 * rejected hydration could overwrite the error banner of a
 * fresh selection.
 */
export async function hydrateForSelection(
  host: SelectionHost,
  componentId: string,
  boardIdOverride?: string
): Promise<SelectionResult> {
  const seq = ++host._selectionSeq;
  const boardId = boardIdOverride ?? host.board?.id ?? undefined;
  try {
    const entry = await fetchComponent(
      host._api,
      componentId,
      host.platform || undefined,
      boardId
    );
    if (seq !== host._selectionSeq) return { kind: "stale" };
    if (!entry) {
      return { kind: "error", message: host._localize("device.add_component_error") };
    }
    return { kind: "ok", entry };
  } catch (err) {
    if (seq !== host._selectionSeq) return { kind: "stale" };
    return {
      kind: "error",
      message:
        err instanceof Error ? err.message : host._localize("device.add_component_error"),
    };
  }
}
