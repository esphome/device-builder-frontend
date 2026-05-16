import type { ComponentCatalogEntry } from "../../api/types.js";
import type { ESPHomeAPI } from "../../api/index.js";

/**
 * Slice of ``ESPHomeAddComponentDialog`` state that the dep-nav
 * helper reads and writes. Lives in this module so the flow can
 * be unit-tested against a plain object instead of mounting the
 * dialog element.
 */
export interface DepNavHost {
  readonly _api: ESPHomeAPI;
  platform: string;
  board: { id: string } | null;
  _catalog: { filterByDomain(domain: string): void } | null;
  _selected: ComponentCatalogEntry | null;
  _returnTo: ComponentCatalogEntry | null;
  _depDomain: string | null;
  _submitError: string;
  _submitting: boolean;
  _depNavSeq: number;
  readonly updateComplete: Promise<boolean>;
}

/**
 * Handle a "navigate to dependency" request from the form's
 * missing-deps banner (or an ID-reference dropdown).
 *
 * Top-level deps (``i2c``, ``uart``, ``spi``) resolve to a single
 * catalog id, so we fetch that entry by id and retarget the form
 * directly. Routing through the catalog's fuzzy search would rank
 * every sensor whose description mentions the bus name above the
 * bus entry itself. Domain-level deps (``output``, ``sensor``)
 * don't resolve to a single id, so they fall back to the
 * category-filtered catalog where the user picks a variant.
 *
 * A sequence counter drops stale responses: bumped on every call
 * here and on ``_resetDetourState`` / ``_onFormSubmit``, so a late
 * resolve after the user moved on (closed the dialog, picked a
 * different dep, submitted the form) can't overwrite ``_selected``.
 */
export async function navigateToDep(
  host: DepNavHost,
  domain: string,
): Promise<void> {
  if (host._submitting) return;
  // Snapshot the in-progress component but DON'T commit ``_returnTo``
  // yet. The original form is still rendered during the await, so a
  // request-add-component path where submit is enabled would let the
  // user submit during this window; ``_onFormSubmit`` reading a set
  // ``_returnTo`` would misclassify that submit as completing a dep
  // detour. Commit only once the lookup resolves and we're actually
  // navigating away.
  const previousSelected = host._selected;
  host._submitError = "";
  const seq = ++host._depNavSeq;
  let direct: ComponentCatalogEntry | null = null;
  try {
    direct = await host._api.getComponent(
      domain,
      host.platform || undefined,
      host.board?.id ?? undefined,
    );
  } catch {
    direct = null;
  }
  if (seq !== host._depNavSeq) return;
  if (previousSelected) {
    host._returnTo = previousSelected;
    host._depDomain = domain;
  }
  if (direct) {
    host._selected = direct;
    return;
  }
  host._selected = null;
  await host.updateComplete;
  if (seq !== host._depNavSeq) return;
  host._catalog?.filterByDomain(domain);
}
